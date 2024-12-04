import { promises as fs } from "fs";

async function fixProcessSlash() {
  const filePath = "./main.js"; // Ensure this matches your build output file
  console.log(`Post-build fix: Checking ${filePath}...`);

  try {
    // Check if the output file exists
    await fs.access(filePath);

    let contents = await fs.readFile(filePath, "utf8");

    // Log occurrences of `require("process/")` for debugging
    const occurrences = (contents.match(/require\(["']process\/["']\)/g) || []).length;
    if (occurrences > 0) {
      console.log(`Found ${occurrences} occurrences of \`require("process/\")\`. Fixing...`);

      // Replace all occurrences of `require("process/")` with `require("process")`
      contents = contents.replace(/require\(["']process\/["']\)/g, 'require("process")');

      // Write the updated content back to the file
      await fs.writeFile(filePath, contents, "utf8");
      console.log("Post-build fix applied successfully.");
    } else {
      console.log("No occurrences of `require(\"process/\")` found. No changes made.");
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Output file does not exist. Skipping post-build fix.");
    } else {
      console.error(`Failed to apply post-build fix: ${err.message}`);
      process.exit(1);
    }
  }
}

fixProcessSlash();
