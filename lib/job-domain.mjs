// Version this whenever stored normalization or query semantics change.
export const DOMAIN_VERSION = 1;
export const dimensions = {
  cities: "city",
  occupations: "occupation",
  industries: "industry",
  sources: "source",
  experiences: "exp_group",
  educations: "education_level",
  scales: "scale",
  properties: "property",
  hiringTypes: "employment_type",
  hiringChannels: "hiring_channel",
  skills: "skill",
};
export function defaults() {
  return {
    query: "",
    company: "",
    country: "中国",
    cities: [],
    major: "",
    occupations: [],
    industries: [],
    sources: [],
    experiences: [],
    educations: [],
    scales: [],
    properties: [],
    hiringTypes: [],
    hiringChannels: [],
    skills: [],
    skillMode: "any",
    salaryLow: "",
    salaryHigh: "",
    salaryMode: "overlap",
    dateField: "updatedAt",
    dateFrom: "",
    dateTo: "",
    keepUnknownDate: true,
    includeUnknownCity: false,
    jobStatus: "all",
    salaryOnly: false,
    majorRequired: false,
    entryOnly: false,
  };
}
export const chinaToday = (now = Date.now()) =>
  new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export const validSalary = (r) =>
  Number.isFinite(r.salaryMin) &&
  Number.isFinite(r.salaryMax) &&
  r.salaryMin >= 0 &&
  r.salaryMax >= r.salaryMin;
export function educationLevel(value) {
  const r = value || "未披露";
  return /未披露|未知/.test(r)
    ? "未披露"
    : /不限|不要求/.test(r)
      ? "学历不限"
      : /博士/.test(r)
        ? "博士"
        : /硕士|研究生/.test(r)
          ? "硕士"
          : /本科/.test(r)
            ? "本科"
            : /中等专科|中专|中技|技工|职业高中/.test(r)
              ? "中专 / 中技 / 职高"
              : /大专|专科/.test(r)
                ? "大专"
                : /高中/.test(r)
                  ? "高中"
                  : /初中|小学/.test(r)
                    ? "初中及以下"
                    : "其他 / 层级未明";
}
export function experienceGroup(text = "未披露") {
  if (/未披露|未知/.test(text)) return "经验未披露";
  if (/不限|应届|无经验|1年以下/.test(text)) return "应届 / 经验不限";
  const cn = {
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const m = text.match(/(\d+|[一两二三四五六七八九十])年|^(\d+)-/),
    n = m ? Number(m[1] || m[2]) || cn[m[1]] : null;
  return n === null
    ? "经验未披露"
    : n < 3
      ? "最低经验1–2年"
      : n < 5
        ? "最低经验3–4年"
        : "最低经验5年以上";
}
export function normalizeJob(r, ordinal, geography = {}) {
  const cities = [...new Set(r.workCities || [])];
  const groups = [...new Set(r.cityGroups || [])];
  const major = r.majorRequirements || "未披露";
  const joined = [
    r.title,
    r.employmentType,
    r.hiringChannel,
    r.experience,
  ].join(" ");
  const entry = /应届|实习|校招|校园/.test(
    `${r.experience} ${r.employmentType} ${r.hiringChannel} ${r.hiringType} ${r.title}`,
  );
  const minimum = String(r.experience || "").match(
    /(\d+)\s*(?:[-–至到]\s*\d+)?\s*年/,
  );
  return {
    id: r.id,
    ordinal,
    title: r.title,
    company: r.company,
    country: r.country,
    location: r.location,
    occupation: r.occupation,
    category: r.category,
    industry: r.industry || "未披露",
    source: r.source,
    education: r.education || "未披露",
    education_level: educationLevel(r.education),
    experience: r.experience || "未披露",
    exp_group: experienceGroup(r.experience),
    employment_type: r.employmentType || "未披露",
    hiring_channel: r.hiringChannel || "未披露",
    scale: r.scale || "未披露",
    property: r.property || "未披露",
    salary_min: r.salaryMin,
    salary_max: r.salaryMax,
    salary_midpoint: validSalary(r) ? (r.salaryMin + r.salaryMax) / 2 : null,
    salary_valid: Number(validSalary(r)),
    published_at: r.publishedAt || null,
    updated_at: r.updatedAt || null,
    expires_at: r.expiresAt || null,
    city_known: Number(cities.length > 0),
    mainland: Number(
      r.country === "中国" &&
        !/^(香港|澳门|台湾)(?:省|特别行政区|市|$)/.test(r.location || ""),
    ),
    major_required: Number(
      !/^(?:未披露|专业不限|不限专业|不限|无要求)[。；\s]*$/.test(major.trim()),
    ),
    entry_only: Number(entry),
    intern: Number(/实习/.test(joined)),
    graduate: Number(
      /应届|校招|校园招聘|毕业生/.test(
        [r.title, r.hiringChannel, r.experience].join(" "),
      ),
    ),
    experience_min: minimum ? Number(minimum[1]) : null,
    experience_unlimited: Number(
      /经验不限|不限经验|经验不要求|无经验要求|^不限$/.test(r.experience || ""),
    ),
    search_text:
      `${r.title} ${r.company} ${(r.skills || []).join(" ")} ${r.description || ""}`.toLowerCase(),
    raw_json: JSON.stringify(r),
    cities: cities.map((city) => ({
      city,
      city_group: groups.includes(city)
        ? city
        : (geography.majorCities || []).includes(city)
          ? city
          : "其他大陆城市",
    })),
    skills: [...new Set(r.skills || [])],
    relatedMajors: [...new Set(r.relatedMajors || [])],
  };
}
export function quantiles(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return [0.25, 0.5, 0.75].map((q) => {
    if (s.length < 10) return null;
    const p = (s.length - 1) * q,
      i = Math.floor(p);
    return s[i] + (s[Math.ceil(p)] - s[i]) * (p - i);
  });
}
