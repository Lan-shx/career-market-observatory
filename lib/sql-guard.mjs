// A complete parser for the deliberately small public SQL grammar, not a
// substring denylist. No model-provided SQL string is passed to the database.
export const SQL_COLUMNS = {
  city: "cities",
  city_group: "cities",
  occupation: "occupations",
  title: "query",
  company: "company",
  industry: "industries",
  source: "sources",
  education_level: "educations",
  exp_group: "experiences",
  employment_type: "hiringTypes",
  hiring_channel: "hiringChannels",
  salary_min: "salary",
  salary_max: "salary",
  salary_midpoint: "salary",
  published_at: "date",
  updated_at: "date",
};
export const SQL_SCHEMA = `只读视图 job_search：id（字符串岗位ID）；city（实际城市）、city_group（城市合并组）、occupation（职业ID）、title、company、industry、source、education_level（标准学历）、exp_group（经验分组）、employment_type、hiring_channel 为文本；salary_min/salary_max/salary_midpoint 为元/月数值或NULL；published_at/updated_at 为YYYY-MM-DD或NULL。
唯一允许语法：SELECT DISTINCT id FROM job_search [WHERE 列 运算符 ? [AND ...]]。运算符：=、>=、<=、>、<、LIKE、IN (?,...)、IS NULL、IS NOT NULL。全部值放params数组，LIKE通配符也作为参数。最多12个条件、每个IN最多20值。不允许字面量、OR、JOIN、子查询、函数、注释、LIMIT、ORDER BY、聚合和写操作。服务器按完整匹配范围计算记录数及分位数，证据单独稳定分页，多城市去重。例：{"sql":"SELECT DISTINCT id FROM job_search WHERE city IN (?, ?) AND occupation = ?","params":["深圳","杭州","职业ID"]}。同轮各查询基于冻结范围，后续追问仅替换提及的维度；如要清空条件用query工具的filters空数组/空字符串。`;
const invalid = () =>
  Object.assign(new Error("SQL不符合受限只读语法，请使用参数化岗位查询。"), {
    status: 422,
  });
export function parseSql(sql, params = []) {
  if (
    typeof sql !== "string" ||
    sql.length > 2500 ||
    !Array.isArray(params) ||
    params.length > 100
  )
    throw invalid();
  if (
    params.some(
      (v) =>
        !(
          (typeof v === "string" && v.length <= 150) ||
          (typeof v === "number" &&
            Number.isFinite(v) &&
            Math.abs(v) <= 10000000)
        ),
    )
  )
    throw invalid();
  const tokens = sql.match(/[A-Za-z_][A-Za-z_0-9]*|>=|<=|[=<>?(),]|\S/g) || [];
  let at = 0,
    pi = 0;
  const take = (s) => {
    if (tokens[at]?.toUpperCase() !== s) throw invalid();
    at++;
  };
  take("SELECT");
  take("DISTINCT");
  take("ID");
  take("FROM");
  take("JOB_SEARCH");
  const predicates = [];
  if (at < tokens.length) {
    take("WHERE");
    do {
      if (predicates.length) take("AND");
      const column = tokens[at++]?.toLowerCase();
      if (!Object.hasOwn(SQL_COLUMNS, column)) throw invalid();
      let op = tokens[at++]?.toUpperCase(),
        values = [];
      const value = () => {
        take("?");
        if (pi >= params.length) throw invalid();
        return params[pi++];
      };
      if (op === "IS") {
        let not = false;
        if (tokens[at]?.toUpperCase() === "NOT") {
          at++;
          not = true;
        }
        take("NULL");
        op = not ? "IS NOT NULL" : "IS NULL";
      } else if (op === "IN") {
        take("(");
        values.push(value());
        while (tokens[at] === ",") {
          at++;
          values.push(value());
          if (values.length > 20) throw invalid();
        }
        take(")");
      } else {
        if (!["=", ">=", "<=", ">", "<", "LIKE"].includes(op)) throw invalid();
        values.push(value());
      }
      const number = column.startsWith("salary_");
      if (
        values.some((v) =>
          number ? typeof v !== "number" || v < 0 : typeof v !== "string",
        )
      )
        throw invalid();
      if (op === "LIKE" && (number || !["title", "company"].includes(column)))
        throw invalid();
      if (["city", "city_group"].includes(column) && !["=", "IN"].includes(op))
        throw invalid();
      predicates.push({ column, op, values });
      if (predicates.length > 12) throw invalid();
    } while (at < tokens.length);
  }
  if (at !== tokens.length || pi !== params.length) throw invalid();
  return predicates;
}
export function predicateDimensions(predicate) {
  if (!predicate.column.startsWith("salary_"))
    return [SQL_COLUMNS[predicate.column]];
  if ([">", ">="].includes(predicate.op)) return ["salaryLow"];
  if (["<", "<="].includes(predicate.op)) return ["salaryHigh"];
  return ["salaryLow", "salaryHigh"];
}
export function predicateSql(predicates) {
  const params = [];
  const clauses = predicates.map(({ column, op, values }) => {
    // Predicates are only constructed by parseSql; revalidate persisted data.
    if (
      !Object.hasOwn(SQL_COLUMNS, column) ||
      ![
        "=",
        ">=",
        "<=",
        ">",
        "<",
        "LIKE",
        "IN",
        "IS NULL",
        "IS NOT NULL",
      ].includes(op)
    )
      throw invalid();
    params.push(...values);
    return `${column} ${op}${op === "IN" ? " (" + values.map(() => "?").join(",") + ")" : op.startsWith("IS ") ? "" : " ?"}`;
  });
  return {
    sql: `SELECT DISTINCT id FROM job_search WHERE dataset_id = ?${clauses.length ? " AND " + clauses.join(" AND ") : ""}`,
    params,
  };
}
