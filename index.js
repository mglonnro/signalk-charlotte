const WebSocket = require("ws");

module.exports = function (app) {
  var plugin = {};
  var unsubscribes = [];
  var ws = null;
  var ws_alive = false;
  var ws_timeout = null;
  var ws_interval = null;

  const server = "wss://community.nakedsailor.blog/api.beta/boat/";
  const retry_period = 3000; // retry for failed connections

  // This mapping would probably be better to do server-side. But this is alpha 0.0.1 so #fixme later :).
  var valuemap = {
    "navigation.courseOverGroundTrue": { name: "cog", type: "rad" },
    "navigation.courseOverGroundMagnetic": { name: "cogm", type: "rad" },
    "navigation.attitude": { name: { pitch: "p", roll: "r" }, type: "rad" },
    "navigation.speedOverGround": { name: "sog" },
    "navigation.position": { name: { latitude: "lat", longitude: "lng" } },
    "navigation.speedThroughWater": { name: "spd" },
    "navigation.headingTrue": { name: "headingt", type: "rad" },
    "navigation.headingMagnetic": { name: "heading", type: "rad" },
    "navigation.magneticVariation": { name: "variation", type: "rad" },
    "steering.rudderAngle": { name: "rudder", type: "rad" },
    "environment.water.temperature": { name: "seatemp" },
    "environment.wind.speedApparent": { name: "aws" },
    "environment.wind.angleApparent": { name: "awa", type: "rad" },
    "environment.depth.belowTransducer": { name: "depth" },
  };

  plugin.id = "signalk-charlotte";
  plugin.name = "SignalK to Charlotte";
  plugin.description = "Stream data from SignalK to the Charlotte cloud";

  plugin.start = function (options, restartPlugin) {
    // Here we put our plugin logic
    app.debug("Plugin started");

    if (!options.boatId || !options.apiKey || !options.period) {
      app.debug("Missing option (boatId, apiKey, period).");
      return;
    }

    // Open web socket client to the cloud.

    ws_interval = setInterval(() => {
      if (ws_alive) {
        return;
      }

      if (ws) {
        ws.close();
      }

      ws = new WebSocket(
        server + options.boatId + "/data?api_key=" + options.apiKey
      );

      ws.on("open", () => {
        app.debug("Socket open.");
        ws_alive = true;
      });

      ws.on("message", (data) => {
        app.debug("Message received: " + data);
      });

      ws.on("close", () => {
        app.debug("Cloud socket closed.");
        ws_alive = false;
      });
    }, retry_period);

    let me = "vessels." + app.getSelfPath("uuid");
    app.debug("I am " + me);

    let localSubscription = {
      context: "*", // Get data for all contexts
      subscribe: [
        {
          path: "*", // Get all paths
          period: options.period,
        },
      ],
    };

    app.subscriptionmanager.subscribe(
      localSubscription,
      unsubscribes,
      (subscriptionError) => {
        app.error("Error:" + subscriptionError);
      },
      (delta) => {
        if (delta.context != me) {
          return;
        }

        delta.updates.forEach((u) => {
          if (u.source && u.values) {
            let src = u.source.src;

            let o = {};
            if (options.includeTimestamp) {
              o.time = new Date(u.timestamp);
            }

            let hasData = false;

            for (let x = 0; x < u.values.length; x++) {
              let path = u.values[x].path;

              if (valuemap[path]) {
                if (typeof valuemap[path].name == "object") {
                  for (let k in valuemap[path].name) {
                    if (u.values[x].value[k] !== undefined) {
                      o[valuemap[path].name[k]] = {
                        [src]: formatValue(
                          u.values[x].value[k],
                          valuemap[path].type
                        ),
                      };
                    }
                  }
                } else {
                  o[valuemap[path].name] = {
                    [src]: formatValue(u.values[x].value, valuemap[path].type),
                  };
                }

                hasData = true;
              } else {
                // app.debug("Skipping: " + path);
              }
            }

            if (ws && ws_alive && hasData) {
              app.debug("Sending: " + JSON.stringify(o));
              ws.send(JSON.stringify(o));
            }
          }
        });
      }
    );
  };

  plugin.stop = function () {
    // Here we put logic we need when the plugin stops
    unsubscribes.forEach((f) => f());
    unsubscribes = [];

    if (ws_interval) {
      clearInterval(ws_interval);
      ws_interval = null;
    }

    if (ws) {
      ws.close();
    }

    app.debug("Plugin stopped");
  };

  plugin.schema = {
    type: "object",
    required: ["boatId", "apiKey", "period"],
    properties: {
      boatId: {
        type: "string",
        title: "Boat ID",
        description:
          "The Boat ID retrieved from the settings page on https://charlotte.lc",
      },
      apiKey: {
        type: "string",
        title: "API Key",
        description:
          "The API Key retrieved from the settings page on https://charlotte.lc",
      },
      period: {
        type: "number",
        title:
          "Update period in milliseconds. Default: 100 ms = 10 times/second",
        description:
          "Specify how frequently the plugin will send data to Charlotte. The default value is 100 ms, meaning 10 times per second. 1000 ms would be once a second.",
        default: 100,
      },
      includeTimestamp: {
        type: "boolean",
        title: "Include timestamps.",
        default: true,
        description:
          "Uncheck this if you want to replay existing log data as if it is happening live",
      },
    },
  };

  return plugin;
};

const formatValue = (value, type) => {
  if (!type) {
    return value;
  }

  if (type == "rad") {
    return value * (180 / Math.PI);
  }
};
