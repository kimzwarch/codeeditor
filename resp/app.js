function $(id) {
  return document.getElementById(id);
}

function setLog(el, msg) {
  el.textContent = msg;
}

function setDownload(linkEl, filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  linkEl.href = url;
  linkEl.download = filename;
  linkEl.classList.remove("disabled");
}

async function readFileAsText(file) {
  if (!file) {
    throw new Error("Missing file upload.");
  }
  return await file.text();
}

/**
 * Parse a unified diff that contains a single file diff.
 * Supports standard git-style output:
 * --- a/Code.gs
 * +++ b/Code.gs
 * @@ -210,7 +210,8 @@
 */
function parseUnifiedDiff(diffText) {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  let oldPath = null;
  let newPath = null;
  const hunks = [];

  // Find file headers
  while (i < lines.length && !lines[i].startsWith("--- ")) {
    i += 1;
  }
  if (i >= lines.length) {
    throw new Error("Diff parse error: missing '--- a/...' header.");
  }
  oldPath = lines[i].slice(4).trim();
  i += 1;

  if (i >= lines.length || !lines[i].startsWith("+++ ")) {
    throw new Error("Diff parse error: missing '+++ b/...' header.");
  }
  newPath = lines[i].slice(4).trim();
  i += 1;

  const hunkHeaderRe = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("@@")) {
      const m = line.match(hunkHeaderRe);
      if (!m) {
        throw new Error(`Diff parse error: invalid hunk header: ${line}`);
      }

      const oldStart = parseInt(m[1], 10);
      const oldLen = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newLen = m[4] ? parseInt(m[4], 10) : 1;

      i += 1;
      const hunkLines = [];
      while (i < lines.length) {
        const l = lines[i];

        // next hunk or end
        if (l.startsWith("@@") || l.startsWith("--- ")) {
          break;
        }

        // allow "\ No newline at end of file" meta line
        if (l.startsWith("\\ No newline at end of file")) {
          hunkLines.push({ type: "\\", text: l });
          i += 1;
          continue;
        }

        const prefix = l[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") {
          // Some diffs can contain empty lines which still have a prefix.
          // If it doesn't, that's malformed.
          throw new Error(`Diff parse error: line missing prefix (+/-/space): "${l}"`);
        }

        hunkLines.push({ type: prefix, text: l.slice(1) });
        i += 1;
      }

      hunks.push({ oldStart, oldLen, newStart, newLen, lines: hunkLines });
      continue;
    }

    i += 1;
  }

  return { oldPath, newPath, hunks };
}

function basename(p) {
  // handles a/Code.gs, b/Code.gs
  return p.replace(/^a\//, "").replace(/^b\//, "").split("/").pop();
}

function detectEOL(text) {
  // preserve original EOL style in output
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Apply a parsed diff to oldText.
 * strict = true => fail if a hunk cannot be applied exactly at target line.
 * strict = false => if target line check fails, attempt exact block search,
 *                   but only if it matches exactly once.
 */
function applyDiffToText(oldText, parsed, strict) {
  const eol = detectEOL(oldText);
  const oldLines = oldText.replace(/\r\n/g, "\n").split("\n");

  let offset = 0; // line index shifts after splices

  const logs = [];
  logs.push(`File: ${basename(parsed.oldPath)} -> ${basename(parsed.newPath)}`);
  logs.push(`Hunks: ${parsed.hunks.length}`);
  logs.push(`Mode: ${strict ? "STRICT" : "SAFE-FALLBACK"}`);
  logs.push("");

  for (let h = 0; h < parsed.hunks.length; h += 1) {
    const hk = parsed.hunks[h];

    const expectedOldBlock = hk.lines
      .filter((x) => x.type === " " || x.type === "-")
      .map((x) => x.text);

    const replacementBlock = hk.lines
      .filter((x) => x.type === " " || x.type === "+")
      .map((x) => x.text);

    // target index based on original oldStart, adjusted by offset
    let targetIdx = hk.oldStart - 1 + offset;

    const slice = oldLines.slice(targetIdx, targetIdx + expectedOldBlock.length);

    const exactMatchAtTarget =
      slice.length === expectedOldBlock.length &&
      slice.every((v, idx) => v === expectedOldBlock[idx]);

    if (!exactMatchAtTarget) {
      const header = `@@ -${hk.oldStart},${hk.oldLen} +${hk.newStart},${hk.newLen} @@`;

      if (strict) {
        throw new Error(
          `HUNK FAILED (strict)\n${header}\n` +
            "Reason: context did not match at target line.\n" +
            "Tip: your old file is not the same baseline this diff was generated from."
        );
      }

      // fallback: search exact expectedOldBlock in entire file
      const matches = [];
      for (let j = 0; j <= oldLines.length - expectedOldBlock.length; j += 1) {
        let ok = true;
        for (let k = 0; k < expectedOldBlock.length; k += 1) {
          if (oldLines[j + k] !== expectedOldBlock[k]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matches.push(j);
        }
      }

      if (matches.length !== 1) {
        throw new Error(
          `HUNK FAILED (fallback)\n${header}\n` +
            `Reason: expected block match count = ${matches.length} (needs exactly 1).\n` +
            "This prevents accidental wrong edits."
        );
      }

      targetIdx = matches[0];
      logs.push(`Hunk ${h + 1}: target mismatch, fallback matched at line ${targetIdx + 1}`);
    } else {
      logs.push(`Hunk ${h + 1}: applied at line ${targetIdx + 1}`);
    }

    // splice: replace expectedOldBlock with replacementBlock
    oldLines.splice(targetIdx, expectedOldBlock.length, ...replacementBlock);

    // update offset
    offset += replacementBlock.length - expectedOldBlock.length;
  }

  const newText = oldLines.join("\n").replace(/\n/g, eol);
  return { newText, logs: logs.join("\n") };
}

async function runJob({ oldInputId, diffInputId, logId, downloadId, outName }) {
  const oldFile = $(oldInputId).files[0];
  const diffFile = $(diffInputId).files[0];
  const logEl = $(logId);
  const dlEl = $(downloadId);

  dlEl.classList.add("disabled");
  dlEl.href = "#";
  setLog(logEl, "");

  try {
    const strict = $("strictMode").checked;

    const [oldText, diffText] = await Promise.all([
      readFileAsText(oldFile),
      readFileAsText(diffFile),
    ]);

    const parsed = parseUnifiedDiff(diffText);

    // sanity: require the diff to be for the intended filename? optional but recommended:
    // If you want, enforce it:
    // if (basename(parsed.newPath).toLowerCase() !== expectedName.toLowerCase()) ...

    const { newText, logs } = applyDiffToText(oldText, parsed, strict);

    setDownload(dlEl, outName, newText);
    setLog(logEl, `✅ Success\n\n${logs}`);
  } catch (err) {
    setLog(logEl, `❌ Error\n\n${err.message || String(err)}`);
  }
}

function init() {
  $("applyA").addEventListener("click", () =>
    runJob({
      oldInputId: "oldA",
      diffInputId: "diffA",
      logId: "logA",
      downloadId: "downloadA",
      outName: "1-codegs.txt",
    })
  );

  $("applyB").addEventListener("click", () =>
    runJob({
      oldInputId: "oldB",
      diffInputId: "diffB",
      logId: "logB",
      downloadId: "downloadB",
      outName: "1-qsinput.txt",
    })
  );
}

document.addEventListener("DOMContentLoaded", init);
