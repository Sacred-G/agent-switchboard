export const normalizeQuotes = (text: string): string => {
  if (!text) return text;
  return text.replace(/[“”„‟＂]/g, '"').replace(/[‘’＇]/g, "'");
};

export const normalizeTomlText = (text: string): string =>
  normalizeQuotes(text);
