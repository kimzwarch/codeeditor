const originalInput = document.getElementById("original-input");
const changesInput = document.getElementById("changes-input");
const output = document.getElementById("output");
const status = document.getElementById("status");
const applyButton = document.getElementById("apply-btn");
const copyButton = document.getElementById("copy-btn");
const originalFile = document.getElementById("original-file");
const changesFile = document.getElementById("changes-file");

const readFileToTextarea = (file, textarea) => {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    textarea.value = reader.result;
  };
  reader.readAsText(file);
};

originalFile.addEventListener("change", (event) => {
  readFileToTextarea(event.target.files[0], originalInput);
});

changesFile.addEventListener("change", (event) => {
  readFileToTextarea(event.target.files[0], changesInput);
});

const applyPatch = (originalText, changesText) => {
  const originalLines = originalText.split("\n");
  const patchLines = changesText.split("\n");
  const updatedLines = [...originalLines];
  let cursor = 0;
  const messages = [];

  patchLines.forEach((line) => {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith("-")) {
      const target = trimmed.slice(1).trimStart();
      const index = updatedLines.findIndex(
        (existing, position) => position >= cursor && existing === target
      );
      if (index !== -1) {
        updatedLines.splice(index, 1);
        cursor = index;
      } else {
        messages.push(`Could not find line to remove: ${target}`);
      }
    } else if (trimmed.startsWith("+")) {
      const addition = trimmed.slice(1).trimStart();
      updatedLines.splice(cursor, 0, addition);
      cursor += 1;
    } else {
      messages.push(`Ignored line without +/- prefix: ${trimmed}`);
    }
  });

  return {
    text: updatedLines.join("\n"),
    warnings: messages,
  };
};

applyButton.addEventListener("click", () => {
  const originalText = originalInput.value.trimEnd();
  const changesText = changesInput.value.trimEnd();

  if (!originalText || !changesText) {
    status.textContent = "Please provide both original code and changes.";
    output.value = "";
    copyButton.disabled = true;
    return;
  }

  const { text, warnings } = applyPatch(originalText, changesText);
  output.value = text;

  if (warnings.length) {
    status.textContent = `Applied with ${warnings.length} warning(s).`;
  } else {
    status.textContent = "Patch applied successfully.";
  }

  copyButton.disabled = !text;
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    status.textContent = "Updated code copied to clipboard.";
  } catch (error) {
    status.textContent = "Clipboard access failed. Please copy manually.";
  }
});
