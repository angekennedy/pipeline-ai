import { setupServer } from "msw/node";
import { openaiHandlers } from "./openai";

export const server = setupServer(...openaiHandlers);
