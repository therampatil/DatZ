import { PipelineOrchestrator } from "./pipelineOrchestrator.js";

export async function runPropertyScraper() {
  return await PipelineOrchestrator.runFullPipeline();
}
