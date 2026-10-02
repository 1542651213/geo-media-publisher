export interface ColleaguePackageSelection {companyId:string;articleIds:string[];assetIds:string[];includeTemplates:boolean;includeFacts?:boolean}
export interface ColleaguePackagePreview {packageId:string;contentFingerprint:string;companyName:string;articleCount:number;assetCount:number;templateCount:number;factCount:number;authorizationIncluded:false;jobsIncluded:false}
export interface ColleaguePackagesApi {
  export(input:ColleaguePackageSelection):Promise<ColleaguePackagePreview&{directory:string}>;
  pick():Promise<(ColleaguePackagePreview&{previewId:string})|null>;
  import(previewId:string):Promise<ColleaguePackagePreview&{companyId:string}>;
}
