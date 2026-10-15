/**
 * A pasted list of words and clues, one per line: the word, then a tab, a
 * dash (- – —) with spaces around it, or a colon, then the clue. A line with
 * none of those is a word still waiting for its clue.
 */
export function parseWordList(text: string): { answer: string; clue: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const match = /^(.+?)(?:\t+|\s+[—–-]\s+|\s*:\s+)(.+)$/.exec(line);
      return match ? { answer: match[1].trim(), clue: match[2].trim() } : { answer: line, clue: "" };
    });
}
