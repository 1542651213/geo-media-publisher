import type { KeywordTemplate } from "./types";

export interface CityRegion {
  province: string;
  city: string;
  district?: string;
}

export interface KeywordExpansionInput {
  brandId: string;
  cities: string[];
  templates: KeywordTemplate[];
  regions?: CityRegion[];
  brandName?: string;
  mainBusiness?: string;
}

export interface ExpandedKeyword {
  brandId: string;
  city: string;
  keyword: string;
  sourceTemplateId: string;
}

export function expandKeywords(input: KeywordExpansionInput): ExpandedKeyword[] {
  const seen = new Set<string>();
  const result: ExpandedKeyword[] = [];
  const regions: CityRegion[] = input.regions?.length ? input.regions : input.cities.map((city) => ({ province: "", city: city.trim() }));
  for (const region of regions.filter((item) => item.city.trim())) {
    const city = region.city.trim();
    for (const template of input.templates.filter((item) => item.enabled)) {
      const keyword = template.template
        .replaceAll("{省}", region.province.trim())
        .replaceAll("{城市}", city)
        .replaceAll("{区县}", region.district?.trim() ?? "")
        .replaceAll("{品牌}", input.brandName ?? "")
        .replaceAll("{业务}", input.mainBusiness ?? "")
        .replace(/\s+/gu, " ")
        .trim();
      const key = `${city}\u0000${keyword}`;
      if (!keyword || seen.has(key)) continue;
      seen.add(key);
      result.push({ brandId: input.brandId, city, keyword, sourceTemplateId: template.id });
    }
  }
  return result;
}
