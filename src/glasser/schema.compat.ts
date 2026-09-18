import type { operations } from "./schema.gen.js";
import type { BalanceResponse, EndpointDetail, Run } from "./schema.js";

type ApiRun = operations["runs-get"]["responses"][200]["content"]["application/json"];
type ApiEndpoint = operations["endpoints-inspect"]["responses"][200]["content"]["application/json"];
type ApiBalance = operations["balance"]["responses"][200]["content"]["application/json"];
type Assert<T extends true> = T;
type Agrees<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compare both directions so optionality and new enum members cause a type error.
// input_schema is intentionally opaque; OpenAPI represents its arbitrary JSON as {}.
export type ContractChecks = [
  Assert<Agrees<Run, Pick<ApiRun, keyof Run>>>,
  Assert<
    Agrees<
      Omit<EndpointDetail, "input_schema">,
      Pick<ApiEndpoint, Exclude<keyof EndpointDetail, "input_schema">>
    >
  >,
  Assert<Agrees<BalanceResponse, ApiBalance>>,
];
