import React, { Component } from "react";
import logo from "./logo.svg";
import "./App.css";
import ChartistGraph from "react-chartist";
import "chartist/dist/chartist.min.css";
import allData from "./data.json";
import uniq from "lodash/uniq";
import groupBy from "lodash/groupBy";
import Chartist from "chartist";
import PluginTooltip from "chartist-plugin-tooltip";
import PluginAxisTitle from "chartist-plugin-axistitle";

const QUERIES = Object.keys(allData).sort();

const makeOptions = (title, o) => {
  let valueTransform;
  if (o.yTransform) {
    valueTransform = v => {
      const [x, y] = v.split(",");
      return `${o.yTransform(parseFloat(y))} @ ${x} rps`;
    };
  }

  return {
    ...o,
    valueTransform,
    title,
    options: {
      ...o.options,
      axisX: {
        type: Chartist.FixedScaleAxis,
        onlyInteger: true,
        ...o.axisX
      }
    }
  };
};

const formatMs = ms => (ms ? ms.toFixed(0) : null);

const CONFIG_BY_STAT = {
  latMean: makeOptions("Average latency (ms, lower is better)", {
    high: 300,
    unit: "ms",
    yTransform: v => `${formatMs(v)}ms`
  }),
  lat50: makeOptions("50th Percentile Latency (ms, lower is better)", {
    high: 300,
    unit: "ms",
    yTransform: v => `${formatMs(v)}ms`
  }),
  lat95: makeOptions("95th Percentile Latency (ms, lower is better)", {
    high: 500,
    unit: "ms",
    yTransform: v => `${formatMs(v)}ms`
  }),
  lat99: makeOptions("99th Percentile Latency (ms, lower is better)", {
    high: 4000,
    unit: "ms",
    yTransform: v => `${formatMs(v)}ms`
  }),
  latMax: makeOptions("Maximum Latency (ms, lower is better)", {
    high: 4000,
    unit: "ms",
    yTransform: v => `${formatMs(v)}ms`
  }),
  success: makeOptions("Successful requests (higher is better)", {
    hideFailureCount: true,
    yTransform: v => `${v} successful requests`
  }),
  failure: makeOptions("Failed requests (lower is better)", {
    hideFailureCount: true,
    yTransform: v => `${v} failed requests`
  })
};

const ALL_STATS = Object.keys(CONFIG_BY_STAT);

class App extends Component {
  state = {
    query: QUERIES[0],
    stat: "lat95",
    smoothed: false,
    sensibleLimits: true
  };

  handleSetQuery = e => {
    this.setState({ query: e.target.value });
  };

  handleSetStat = e => {
    this.setState({ stat: e.target.value });
  };

  handleSetSmoothed = e => {
    this.setState({ smoothed: e.target.checked });
  };

  handleSetSensibleLimits = e => {
    this.setState({ sensibleLimits: e.target.checked });
  };

  listener = {
    draw: context => {
      if (context.type === "point") {
        const config = CONFIG_BY_STAT[this.state.stat] || {};
        const {
          series: { data },
          index,
          element
        } = context;
        const { successProportion } = data[index];
        if (successProportion < 0.999) {
          const x =
            (parseFloat(element.attr("x1")) + parseFloat(element.attr("x2"))) /
            2;
          const y =
            (parseFloat(element.attr("y1")) + parseFloat(element.attr("y2"))) /
            2;
          const s = 6;
          const makePath = size =>
            `M ${x - size / 2} ${y -
              size / 2} l ${size} ${size} m -${size} 0 l ${size} -${size}`;
          const cross = element.elem("path", {
            style: `stroke: red; stroke-width: 2px`,
            d: makePath(s)
          });
          const crossBg = element.elem("path", {
            style: `stroke: white; stroke-width: 3.5px`,
            d: makePath(s * 1.25)
          });
          const makeText = bg => {
            const color = bg ? "white" : "red";
            const el = element.elem("text", {
              x,
              y: y - (4 / 5) * s,
              style: `stroke: ${color}; fill: ${color};`,
              ["text-anchor"]: "middle",
              ["font-size"]: "9px",
              ["font-weight"]: "bold",
              ["stroke-width"]: bg ? "2px" : "0px"
            });
            el._node.textContent = `${((1 - successProportion) * 100).toFixed(
              1
            )}%`;
            return el;
          };
          const textBg = makeText(true);
          const text = makeText();
          if (!config.hideFailureCount) {
            element._node.parentNode.insertBefore(crossBg._node, element._node);
            element._node.parentNode.insertBefore(cross._node, element._node);
            element._node.parentNode.insertBefore(textBg._node, element._node);
            element._node.parentNode.insertBefore(text._node, element._node);
            element.attr({
              style: `fill: transparent; stroke: transparent`
            });
          }
        }
      }
    }
  };
  render() {
    const entries = allData[this.state.query];
    const rps = uniq(entries.map(e => e.rps)).sort((a, b) => a - b);
    const groupedEntries = groupBy(entries, e => e.software);
    const softwares = Object.keys(groupedEntries);
    const data = {
      labels: rps.map((r, i) => (i % 2 === 1 ? r : "")),
      series: softwares.map(software => ({
        name: software,
        className: `series-${software.replace(/[^a-z0-9]/g, "-")}`,
        data: rps
          .map(r => {
            const entry = groupedEntries[software].find(e => e.rps === r);
            if (entry) {
              const successProportion =
                entry.success / (entry.failure + entry.success);
              // If more than 0.1% of requests failed, show on graph
              return {
                x: r,
                y: entry[this.state.stat],
                successProportion,
                meta: `${(successProportion * 100).toFixed(2)}% successful`
              };
            } else {
              return { x: r, y: null, successProportion: 0 };
            }
          })
          .filter(p => p.y !== null)
      }))
    };
    const { options: baseOptions, title, valueTransform, high, unit } =
      CONFIG_BY_STAT[this.state.stat] || {};
    const highY = this.state.sensibleLimits ? high : undefined;
    const rpsCeilingBySoftware = softwares.reduce((memo, software) => {
      memo[software] = Infinity;
      return memo;
    }, {});
    const highestX =
      this.state.sensibleLimits && high
        ? entries.reduce((biggestRps, entry) => {
            const val = entry[this.state.stat];
            if (
              val != null &&
              val <= highY &&
              entry.rps < rpsCeilingBySoftware[entry.software]
            ) {
              return Math.max(biggestRps, entry.rps);
            } else {
              rpsCeilingBySoftware[entry.software] = Math.min(
                rpsCeilingBySoftware[entry.software],
                entry.rps
              );
              return biggestRps;
            }
          }, 0)
        : rps[rps.length - 1];
    const highX = rps.find(r => r > highestX) || highestX;
    const options = {
      ...baseOptions,
      axisX: {
        ...baseOptions.axisX,
        ticks: rps.filter((r, i) => i % 2 === 1),
        low: 0,
        high: highX
      },
      high: highY,
      chartPadding: {
        top: 20,
        right: 20,
        bottom: 30,
        left: 40
      },
      showArea: false,
      lineSmooth: this.state.smoothed,
      showGridBackground: false,
      fullWidth: false,
      plugins: [
        PluginTooltip({
          valueTransform
        }),
        PluginAxisTitle({
          axisX: {
            axisTitle: "Requests per second (larger is better)",
            textAnchor: "middle",
            offset: {
              x: 0,
              y: 50
            }
          },
          axisY: {
            axisTitle: title ? title : this.state.stat,
            textAnchor: "middle",
            flipTitle: true,
            offset: {
              x: 0,
              y: 25
            }
          }
        })
      ]
    };
    return (
      <div className="App">
        <div
          style={{
            width: "100%",
            height: "4em",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-evenly",
            backgroundColor: "rgba(0, 0, 0, 0.1)"
          }}
        >
          <div>
            <div>
              Query:{" "}
              <select value={this.state.query} onChange={this.handleSetQuery}>
                {QUERIES.map(q => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
            <div>
              Stat:{" "}
              <select value={this.state.stat} onChange={this.handleSetStat}>
                {ALL_STATS.map(q => (
                  <option key={q} value={q}>
                    {CONFIG_BY_STAT[q].title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={this.state.smoothed}
                  onChange={this.handleSetSmoothed}
                />{" "}
                Smoothed
              </label>
            </div>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={this.state.sensibleLimits}
                  onChange={this.handleSetSensibleLimits}
                />{" "}
                Zoom sensible region
              </label>
            </div>
          </div>
          <div>
            <div className="label-postgraphile">
              postgraphile@4.0.0 (Node 10)
            </div>
            <div className="label-postgraphile-next">
              postgraphile@4.4.1-alpha.4 (Node 12, turbo)
            </div>
            <div className="label-prisma">prisma@1.32</div>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            flex: "1 0 300px",
            display: "flex",
            alignItems: "stretch",
            overflow: "hidden"
          }}
        >
          <div style={{ flex: "1 0 0" }}>
            <ChartistGraph
              key={this.state.stat}
              options={options}
              data={data}
              type={"Line"}
              listener={this.listener}
            />
          </div>
        </div>
      </div>
    );
  }
}

export default App;
