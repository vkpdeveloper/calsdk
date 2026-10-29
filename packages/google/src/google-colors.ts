// Google Calendar's fixed event palette, by `colorId`, as the web app shows it.
// The `/colors` endpoint still reports older, paler shades for the same ids.
export const GOOGLE_EVENT_COLORS: Readonly<Record<string, string>> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

const rgb = (hex: string) =>
  [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

/** The palette entry closest to `hex`, and whether it matches exactly. */
export function nearestColorId(hex: string): { colorId: string; exact: boolean } {
  const target = rgb(hex.toLowerCase());
  let best = { colorId: '1', distance: Number.POSITIVE_INFINITY };
  for (const [colorId, color] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const distance = rgb(color).reduce(
      (sum, channel, index) => sum + (channel - (target[index] ?? 0)) ** 2,
      0,
    );
    if (distance < best.distance) best = { colorId, distance };
  }
  return { colorId: best.colorId, exact: best.distance === 0 };
}
