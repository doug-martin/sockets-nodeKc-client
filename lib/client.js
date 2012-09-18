"use strict";
var comb = require("comb"),
    merge = comb.merge,
    hitch = comb.hitch,
    Logger = comb.logging.Logger,
    URL = require("url"),
    request = require("request"),
    path = require("path"),
    gofigure = require("gofigure")({monitor:true, locations:[path.resolve(__dirname, "../config"), path.resolve(process.env.HOME, "./monitor")]}),
    config = gofigure.loadSync();

var PORT = config.monitor.port || 8088;
var HOST = config.monitor.host || "localhost";
var LOGGER = Logger.getLogger("monitor-client");
var ACTIONS = ['start', 'stop', 'restart', 'status', 'list', 'services'];
comb.define(null, {

    instance:{
        port:PORT,
        host:HOST,
        protocol:"http",

        constructor:function (options) {
            options = options || {};
            comb.isDefined(options.port) && (this.port = options.port);
            comb.isDefined(options.host) && (this.host = options.host);
            comb.isDefined(options.protocol) && (this.protocol = options.protocol);
            ACTIONS.forEach(function (action) {
                this[action] = function (service, options) {
                    return this._makeRequest(action, service, options);
                };
            }, this);
        },

        _getRequest:function (action, service) {
            return {url:this.url(action, service)};
        },

        url:function (action, service, options) {
            options = options || {};
            var url = {
                protocol:this.protocol,
                hostname:this.host,
                port:this.port,
                pathname:"/monitor/" + action
            };
            service && (url.query = merge(options, {service:service}));
            return URL.format(url);
        },

        _makeRequest:function (action, service, options) {
            var ret = new comb.Promise();
            var opts = this._getRequest(action, service, options);
            request(opts, hitch(this, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    ret.callback(JSON.parse(body), response);
                } else {
                    var err = error || new Error("Request status " + response.statusCode);
                    ret.errback(err);
                }
            }));
            return ret;
        }
    }

}).as(module);