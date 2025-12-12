// Create a simple test image (1x1 green pixel PNG)
const fs = require("node:fs");
const path = require("node:path");

// 1x1 green pixel PNG (base64)
const greenPixelBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const imageBuffer = Buffer.from(greenPixelBase64, "base64");
const outputPath = path.join(__dirname, "test-image.png");

fs.writeFileSync(outputPath, imageBuffer);
console.log("Test image created:", outputPath);
