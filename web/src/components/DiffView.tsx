import { useMemo } from "react";
import { diffLines } from "diff";
import type { Change } from "diff";

interface DiffRow {
  kind: "equal" | "changed";
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
}

/**
 * Side-by-side line diff between the active prompt and a candidate.
 * Equal runs share a row; changed/added/removed hunks get their own
 * left/right cells with +/- markers and line numbers.
 */
export default function DiffView({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const rows = useMemo<DiffRow[]>(() => {
    const changes: Change[] = diffLines(before, after);
    const rowsOut: DiffRow[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const change of changes) {
      const text = change.value;
      const trailingNewline = text.endsWith("\n");
      const lines = text.replace(/\n$/, "").split("\n");

      if (change.added) {
        rowsOut.push({
          kind: "changed",
          oldStart: oldLine,
          newStart: newLine,
          oldLines: [],
          newLines: lines,
        });
        newLine += lines.length;
        if (trailingNewline) newLine += 1;
      } else if (change.removed) {
        rowsOut.push({
          kind: "changed",
          oldStart: oldLine,
          newStart: newLine,
          oldLines: lines,
          newLines: [],
        });
        oldLine += lines.length;
        if (trailingNewline) oldLine += 1;
      } else {
        rowsOut.push({
          kind: "equal",
          oldStart: oldLine,
          newStart: newLine,
          oldLines: lines,
          newLines: lines,
        });
        oldLine += lines.length;
        newLine += lines.length;
        if (trailingNewline) {
          oldLine += 1;
          newLine += 1;
        }
      }
    }

    return rowsOut;
  }, [before, after]);

  return (
    <div className="diff" role="region" aria-label="Side-by-side diff">
      <div className="diff-cols" aria-hidden="true">
        <span className="diff-col-head">Active prompt</span>
        <span className="diff-col-head diff-col-head-right">Candidate</span>
      </div>
      <table className="diff-table">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={`diff-row diff-${row.kind}`}>
              <td className="diff-side">
                {row.oldLines.length === 0 ? (
                  <span className="diff-gap" />
                ) : (
                  row.oldLines.map((line, i) => (
                    <div key={i} className="diff-line">
                      <span className="diff-num">{row.oldStart + i}</span>
                      <span className="diff-text">{line || " "}</span>
                    </div>
                  ))
                )}
              </td>
              <td className="diff-side">
                {row.newLines.length === 0 ? (
                  <span className="diff-gap" />
                ) : (
                  row.newLines.map((line, i) => (
                    <div key={i} className="diff-line diff-line-new">
                      <span className="diff-num">{row.newStart + i}</span>
                      <span className="diff-text">{line || " "}</span>
                    </div>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
