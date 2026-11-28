import "dotenv/config";
import { runPropertyScraper } from "./runPropertyScraper.js";

async function main() {
  try {
    const result = await runPropertyScraper();
    console.log("Pipeline result:", result);
    process.exit(0);
  } catch (error) {
    console.error("Pipeline failed:", error);
    process.exit(1);
  }
}

main();
