// Example add-on tool: "what's the weather in <place> right now?"
//
// A tool is a plain object: a spec the model sees (name, description, JSON-schema parameters), a
// default permission tier, an optional availability check, a one-line summary for the activity
// log and approval cards, and run(). This one is read-only and talks to the free Open-Meteo API
// (no key needed), so its default tier is 'auto'. See docs/EXTENDING.md.
//
// To switch it on in your own copy, add one line next to the other tools in src/main.ts:
//   tools.add(createWeatherTool({ enabled: () => true }));
// test/examples.test.ts runs it with a fake fetch (no network) as part of `npm run check`.
import { clip, str, ToolError } from '../../src/tools/types.ts';
import type { Tool } from '../../src/tools/types.ts';

export interface WeatherToolOptions {
  /** Injected in tests; the real global fetch otherwise. */
  fetch?: typeof fetch;
  /** Hide the tool from the model when this returns false (e.g. a setting is off). */
  enabled?: () => boolean;
  geocodeUrl?: string;
  forecastUrl?: string;
}

/** WMO weather codes (the ones Open-Meteo uses) in plain words. */
const CODES: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'icy fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};

export function describeCode(code: number): string {
  return CODES[code] ?? `weather code ${code}`;
}

export function createWeatherTool(opts: WeatherToolOptions = {}): Tool {
  const get = opts.fetch ?? fetch;
  const geocode = opts.geocodeUrl ?? 'https://geocoding-api.open-meteo.com/v1/search';
  const forecast = opts.forecastUrl ?? 'https://api.open-meteo.com/v1/forecast';
  const json = async (url: string, signal: AbortSignal): Promise<unknown> => {
    const res = await get(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!res.ok) throw new ToolError(`The weather service answered HTTP ${res.status}.`);
    return res.json();
  };
  return {
    // Read-only and harmless: runs without asking. Use 'ask' for anything that sends, changes,
    // deletes or spends; 'never' to ship a tool switched off. The owner can change it in Settings.
    defaultPermission: 'auto',
    isAvailable: () => opts.enabled?.() ?? true,
    source: 'example',
    spec: {
      name: 'weather_now',
      description: 'Current weather for a city or place: temperature (°C), wind and conditions. Use it when the owner asks about the weather somewhere.',
      parameters: {
        type: 'object',
        properties: { place: { type: 'string', description: 'City or place name, e.g. "Austin" or "Lisbon, Portugal"' } },
        required: ['place'],
        additionalProperties: false,
      },
    },
    summarize: (a) => `weather in ${String(a.place ?? '?').slice(0, 80)}`,
    async run(args, ctx) {
      const place = str(args, 'place').trim().slice(0, 100);
      const geo = (await json(`${geocode}?count=1&language=en&format=json&name=${encodeURIComponent(place)}`, ctx.signal)) as {
        results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[];
      };
      const hit = geo.results?.[0];
      if (!hit) throw new ToolError(`I couldn't find a place called "${place}".`);
      const wx = (await json(`${forecast}?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`, ctx.signal)) as {
        current?: { time: string; temperature_2m: number; apparent_temperature?: number; wind_speed_10m: number; weather_code: number };
      };
      const c = wx.current;
      if (!c) throw new ToolError('The weather service sent no current conditions.');
      const where = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
      const feels = c.apparent_temperature !== undefined ? ` (feels like ${c.apparent_temperature} °C)` : '';
      // Tool results go back to the model as text; keep them short and factual.
      return clip(`${where} at ${c.time} local time: ${describeCode(c.weather_code)}, ${c.temperature_2m} °C${feels}, wind ${c.wind_speed_10m} km/h. Weather data by Open-Meteo.com`, 2000);
    },
  };
}
