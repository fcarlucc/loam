import { MAX_TOTAL_BYTES } from "./attachments";

// Limits of a temporary chat, which the page sends whole with every message: the server refuses past them,
// and the page says so before sending.
export const MAX_TEMPORARY_MESSAGES = 400;
export const TEMPORARY_TOO_LONG = "This temporary chat is too long: start a new one to go on.";
export const TEMPORARY_FILES_TOO_BIG = `This temporary chat's files take more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together: start a new one to send more.`;
