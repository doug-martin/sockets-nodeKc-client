"use strict";
var comb = require("comb"),
    hitch = comb.hitch,
    DEFAULT_MAX_ERROR_COUNT = 5,
    DEFAULT_INTERVAL = 1000,
    path = require("path"),
    gofigure = require("gofigure")({monitor:true, locations:[path.resolve(process.env.HOME, "./monitor"), path.resolve(__dirname, "../config")]}),
    config = gofigure.loadSync();

gofigure.on("logging.monitor-client.level", function (level) {
    DEFAULT_LOG.info("LEVEL changed to " + level);
    DEFAULT_LOG.level = level;
});

comb.logger.configure(config.logging);

var DEFAULT_LOG = comb.logger("monitor-client");

var Service = comb.define(comb.plugins.Middleware, {

    instance:{

        log:DEFAULT_LOG,


        constructor:function (options) {
            comb.merge(this, options || {});
            this._super(arguments);
        },

        start:function (opts) {
            this.log.info("Starting service");
            return comb.serial([
                hitch(this, "_hook", "pre", "startService"),
                hitch(this, "_startService", opts),
                hitch(this, "_hook", "post", "startService")
            ]);
        },


        status:function () {
            this.log.debug("Checking status");
            return {
                process:{
                    gid:process.getgid(),
                    pid:process.pid,
                    uid:process.getuid(),
                    cwd:process.cwd,
                    version:process.version,
                    title:process.title,
                    memoryUsage:process.memoryUsage(),
                    uptime:process.uptime(),
                },
                log:this.log.fullName
            };
        },

        errorHandler:function (err) {
            this.log.error(err);
        },

        stop:function (opts) {
            this.log.info("Stopping");
            return comb.serial([
                hitch(this, "_hook", "pre", "stopService"),
                hitch(this, "_stopService", opts),
                hitch(this, "_hook", "post", "stopService")
            ]).addErrback(this.errorHandler.bind(this));
        },

        restart:function () {
            comb.serial([
                hitch(this, "_hook", "pre", "restartService"),
                comb.hitch(this, "stop"),
                comb.hitch(this, "start"),
                hitch(this, "_hook", "post", "restartService")
            ]).addErrback(this.errorHandler.bind(this));
            ;
        },

        _startService:function (opts) {
            var ret = new comb.Promise();
            try {
                comb.when(this.startService(opts)).then(ret);
            } catch (e) {
                ret.errback(e);
            }
            return ret;
        },

        _stopService:function (opts) {
            var ret = new comb.Promise();
            try {
                comb.when(this.stopService(opts)).then(ret);
            } catch (e) {
                ret.errback(e);
            }
            return ret;
        },

        startService:function (opts) {
        },

        stopService:function (opts) {
        }
    },

    static:{

        SERVICES:[],

        init:function () {
            this._super(arguments);
            this.SERVICES.push(this);
        },

        start:function (options) {
            var ret = new this(options);
            ret.start();
            return ret;
        }
    }

}).as(exports, "Service");


var CronService = comb.define(Service, {

    instance:{
        interval:DEFAULT_INTERVAL,

        maxErrorCount:DEFAULT_MAX_ERROR_COUNT,

        loopCount:0,


        stopService:function () {
            clearInterval(this.__loopInterval);
        },

        status:function () {
            this.log.debug("LOOP count = " + this.loopCount);
            return comb.merge(this._super(arguments), {
                loopCount:this.loopCount,
                interval:this.interval
            })
        },

        startService:function (opts) {
            var inCheck = false, errorCount = 0,
                maxErrorCount = this.maxErrorCount,
                cb = hitch(this, "loop", opts),
                log = this.log,
                interval = this.interval;

            var loop = (function () {
                if (!inCheck) {
                    if (errorCount < maxErrorCount) {
                        this.loopCount++;
                        this.log.debug("LOOP count = " + this.loopCount);
                        inCheck = true;
                        try {
                            comb.when(cb()).then(
                                function () {
                                    log.debug("LOOP done");
                                    inCheck = false;
                                    errorCount = 0;
                                },
                                function (err) {
                                    log.debug("LOOP erroed");
                                    log.error(err);
                                    inCheck = false;
                                    errorCount++;
                                }
                            )
                        } catch (e) {
                            this.log.debug("LOOP erroed");
                            log.error(e);
                            inCheck = false;
                            errorCount++;
                        }
                    } else {
                        log.error("Max allowed attempts reached");
                        this.stop();
                    }
                }
            }).bind(this);

            comb.when(cb()).both(hitch(this, function () {
                this.loopCount++;
                this.__loopInterval = setInterval(hitch(this, loop), interval);
            }));
        },

        loop:function () {
            throw new Error("Not Implemented");
        }
    }

}).as(exports, "CronService");


Service.SERVICES.splice(Service.SERVICES.indexOf(Service), 1);
Service.SERVICES.splice(Service.SERVICES.indexOf(CronService), 1);

var services = [];
process.on('message', function (options) {
    try {
        DEFAULT_LOG.debug("%4j", [options]);
        var action = options.action, serviceOpts = options.options;
        if (action == "start") {
            DEFAULT_LOG.info("starting services")
            comb.when(Service.SERVICES.map(function (service) {
                var s = new service();
                services.push(s);
                return s.start();
            })).then(function () {
                    DEFAULT_LOG.info("started");
                    process.send({started:true});
                }, function (err) {
                    process.exit();
                    process.send({started:false, error:err.message});
                });

        } else if (action == "stop") {
            DEFAULT_LOG.info("stopping ")
            comb.when(services.map(function (service) {
                return service.stop(serviceOpts);
            })).then(function () {
                    DEFAULT_LOG.info("stopped ")
                    services.length = 0;
                    process.send({stopped:true});
                }, function (error) {
                    DEFAULT_LOG.info("error stopping ")
                    services.length = 0;
                    process.send({stopped:false, error:error.message});
                });
        } else if (action == "status") {
            DEFAULT_LOG.info("statusing")
            comb.when(services.map(function (service) {
                return comb.when(service.status(serviceOpts));
            })).then(function (statuses) {
                    DEFAULT_LOG.info("statused")
                    process.send({status:statuses});
                }, function (error) {
                    process.send({statuses:null, error:error.message});
                });
        }
    } catch (e) {
        DEFAULT_LOG.error("Error " + options.action + "ing : ");
        DEFAULT_LOG.error(e);
        process.send({error:e.message});
    }
});

