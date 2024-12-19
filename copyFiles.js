const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

function copyFile(source, target) {
    const targetFile = target.endsWith(path.sep) ? path.join(target, path.basename(source)) : target;
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(source, targetFile);
    console.log(`Copied: ${source} -> ${targetFile}`);
}

// Base directory for the distribution
const distRoot = path.join("dist", "labbook-explog-fmi");

// Copy compiled main.js for distribution
copyFile("main.js", path.join(distRoot, "main.js"));

// Copy other assets
copyFile("manifest.json", path.join(distRoot, "manifest.json"));
copyFile("styles.css", path.join(distRoot, "styles.css"));

// Copy keytar.node to the correct location
copyFile(
    "node_modules/keytar/build/Release/keytar.node",
    path.join(distRoot, "node_modules/keytar/build/Release/keytar.node")
);

// Create a ZIP file for the distribution
const zipOutputPath = path.join("dist", "labbook-explog-fmi.zip");
const output = fs.createWriteStream(zipOutputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
    console.log(`ZIP file created: ${zipOutputPath} (${archive.pointer()} total bytes)`);
});

archive.on("error", (err) => {
    throw err;
});

archive.pipe(output);
archive.directory(distRoot, "labbook-explog-fmi");
archive.finalize();
