export interface BuildIdentity {
  appVersion:string; deliveryId:string; sourceCommit:string; builtAt:string; migrations:string[];
}
declare const __GEO_BUILD_IDENTITY__:BuildIdentity;
/** One build stamp is embedded in Main, Preload and Renderer; artifact hashes are recorded externally. */
export const BUILD_IDENTITY:BuildIdentity=typeof __GEO_BUILD_IDENTITY__==='undefined'
  ?{appVersion:'1.1.9',deliveryId:'R1.15-G',sourceCommit:'SOURCE_BUILD_REQUIRED',builtAt:'SOURCE_BUILD_REQUIRED',migrations:[]}
  :__GEO_BUILD_IDENTITY__;
