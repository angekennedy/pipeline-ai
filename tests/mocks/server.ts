import { setupServer } from "msw/node";
import { anthropicHandlers } from "./anthropic";

export const server = setupServer(...anthropicHandlers);
