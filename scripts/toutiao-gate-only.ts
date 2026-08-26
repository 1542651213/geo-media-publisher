export interface ToutiaoGateChecks {
  accountIdentity: boolean;
  login: boolean;
  publishPermission: boolean;
  noSecurityVerification: boolean;
  articleEditor: boolean;
  title: boolean;
  body: boolean;
  strictReadback: boolean;
  cover: boolean;
  requiredFields: boolean;
  finalSubmitControl: boolean;
}

export function isToutiaoReadyForFinalSubmit(gates: ToutiaoGateChecks): boolean {
  return gates.accountIdentity
    && gates.login
    && gates.publishPermission
    && gates.noSecurityVerification
    && gates.articleEditor
    && gates.title
    && gates.body
    && gates.strictReadback
    && gates.cover
    && gates.requiredFields
    && gates.finalSubmitControl;
}

