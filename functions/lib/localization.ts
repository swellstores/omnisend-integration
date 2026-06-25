import { OmnisendSettings } from './omnisend-client';

export async function getDefaultLocale(swell: SwellRequest['swell']): Promise<string | undefined> {
  const storeSettings = await swell.get('/settings/store') as any;
  return storeSettings?.locale;
}

export async function getLocalizedRecord(
  swell: SwellRequest['swell'],
  settings: OmnisendSettings,
  path: string,
  params: Record<string, any>,
): Promise<any> {
  const record = await swell.get(path, params as any) as any;
  if (!settings.use_display_locale || !record?.display_locale) {
    return record;
  }

  const defaultLocale = getDefaultLocale(swell);
  if (record.display_locale === defaultLocale) {
    return record;
  }

  return swell.get(path, { ...params, $locale: record.display_locale } as any);
}

export async function getLocalizedResults(
  swell: SwellRequest['swell'],
  settings: OmnisendSettings,
  defaultLocale: string | undefined,
  path: string,
  baseParams: Record<string, any>,
  results: any[],
): Promise<any[]> {
  if (!settings.use_display_locale) {
    return results;
  }

  const localeGroups = new Map<string, string[]>();
  const defaultResults: any[] = [];

  for (const record of results) {
    if (record.display_locale && record.display_locale !== defaultLocale) {
      if (!localeGroups.has(record.display_locale)) {
        localeGroups.set(record.display_locale, []);
      }
      localeGroups.get(record.display_locale)!.push(record.id);
    } else {
      defaultResults.push(record);
    }
  }

  if (localeGroups.size === 0) {
    return results;
  }

  const { page, ...fetchParams } = baseParams;
  const localizedResults = [...defaultResults];

  for (const [locale, ids] of localeGroups) {
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const localized = await swell.get(path, {
        ...fetchParams,
        limit: 1000,
        id: { $in: chunk },
        $locale: locale,
      } as any) as any;
      localizedResults.push(...(localized?.results ?? []));
    }
  }

  return localizedResults;
}
