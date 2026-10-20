import { useState } from "react";
import { GEN_AI } from "../tracing/attrs";
import { formatUsd, loadPrices, parsePrice, savePrices, whatIfCost, type Prices } from "./cost";
import { num, type ViewSpan } from "./model";

/**
 * "What would this run cost on a hosted model?" A local model has no price, so
 * this is an opt-in what-if: the visitor's prices × this run's reported token
 * counts. Rendered only when real token counts exist.
 */
export function CostTable({ chats }: { chats: ViewSpan[] }) {
  const counted = chats.filter((c) => num(c.span.attrs[GEN_AI.usageInputTokens]) !== undefined || num(c.span.attrs[GEN_AI.usageOutputTokens]) !== undefined);
  const [prices, setPrices] = useState<Prices>(() => loadPrices());
  const [text, setText] = useState(() => ({ in: prices.inputPerM?.toString() ?? "", out: prices.outputPerM?.toString() ?? "" }));
  if (counted.length === 0) return null;

  const update = (field: "in" | "out", value: string) => {
    const nextText = { ...text, [field]: value };
    setText(nextText);
    const next = { inputPerM: parsePrice(nextText.in), outputPerM: parsePrice(nextText.out) };
    setPrices(next);
    savePrices(next);
  };
  const inTok = (c: ViewSpan) => num(c.span.attrs[GEN_AI.usageInputTokens]) ?? 0;
  const outTok = (c: ViewSpan) => num(c.span.attrs[GEN_AI.usageOutputTokens]) ?? 0;
  const totalIn = counted.reduce((n, c) => n + inTok(c), 0);
  const totalOut = counted.reduce((n, c) => n + outTok(c), 0);
  const total = whatIfCost(totalIn, totalOut, prices);

  return (
    <details className="atv-whatif">
      <summary>What would this run cost on a hosted model?</summary>
      <p className="atv-footnote">
        This model runs in your browser, so the run itself cost nothing. Enter a hosted model's prices to see a what-if, using your
        prices × this run's real token counts. Prices are saved in this browser only.
      </p>
      <div className="atv-price-inputs">
        <label className="atv-field">
          <span>Input price (USD per 1M tokens)</span>
          <input inputMode="decimal" value={text.in} placeholder="e.g. from a provider's price list" onChange={(e) => update("in", e.target.value)} />
        </label>
        <label className="atv-field">
          <span>Output price (USD per 1M tokens)</span>
          <input inputMode="decimal" value={text.out} placeholder="e.g. from a provider's price list" onChange={(e) => update("out", e.target.value)} />
        </label>
      </div>
      {counted.length < chats.length && (
        <p className="atv-muted">Token counts were reported for {counted.length} of {chats.length} calls; only those are included.</p>
      )}
      <table className="atv-table">
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col" className="num">Input tokens</th>
            <th scope="col" className="num">Output tokens</th>
            <th scope="col" className="num">What-if cost</th>
          </tr>
        </thead>
        <tbody>
          {counted.map((c) => {
            const cost = whatIfCost(inTok(c), outTok(c), prices);
            return (
              <tr key={c.id}>
                <td>{c.span.name.replace(/^chat /, "")} · step {String(c.span.attrs["app.step.index"] ?? "")}</td>
                <td className="num">{inTok(c).toLocaleString()}</td>
                <td className="num">{outTok(c).toLocaleString()}</td>
                <td className="num">{cost === undefined ? "–" : `${formatUsd(cost)} (what-if)`}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">{totalIn.toLocaleString()}</td>
            <td className="num">{totalOut.toLocaleString()}</td>
            <td className="num">{total === undefined ? "Enter both prices" : `${formatUsd(total)} (what-if)`}</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}
