import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export interface ScopedCampaignContent { slot: string; titleSha256: string; bodySha256: string; imageSha256: string }
export interface ScopedCampaignConfig { campaignId: string; accountId: string; creatorId: string; expiresAtUtc: string; content: ScopedCampaignContent[] }
export interface ScopedCampaignBinding extends ScopedCampaignContent { accountId: string; creatorId: string; jobId: string; intentId: string; snapshotId: string; buildSha256: string }
export type ScopedCampaignStage = "slotReserved" | "finalBoundaryClaimed" | "mouseActionInvoked" | "requestObserved" | "platformAccepted" | "published" | "unknown";
type Entry = { seq: number; prev: string; kind: "header" | "reserve" | "mark"; at: string; configSha256?: string; binding?: ScopedCampaignBinding; slot?: string; stage?: ScopedCampaignStage; externalId?: string; digest: string };
type SlotState = { stage: ScopedCampaignStage; binding: ScopedCampaignBinding; externalId?: string };
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
function fail(message: string): never { throw new Error(`XHS_CAMPAIGN_CLOSED: ${message}`); }
const digest = (row: Omit<Entry,"digest">): string => sha(JSON.stringify(row));

/** A deliberately fail-closed, one-process campaign ledger. Corrupt or orphaned locks require manual review. */
export class ScopedXhsCampaignLedger {
  private readonly states = new Map<string, SlotState>();
  private sequence = 0;
  private previousDigest = "GENESIS";
  private closed = false;
  private constructor(private readonly root: string, private readonly config: ScopedCampaignConfig, private readonly now: () => number, private readonly lockNonce: string) {}

  static open(root: string, config: ScopedCampaignConfig, now: () => number = Date.now): ScopedXhsCampaignLedger {
    if (!config.campaignId || !config.accountId || !config.creatorId || !Number.isFinite(Date.parse(config.expiresAtUtc)) || config.content.length !== 3 || config.content.some((c,i) => c.slot !== `XHS-0${i+1}` || !c.titleSha256 || !c.bodySha256 || !c.imageSha256)) fail("configuration incomplete");
    mkdirSync(root,{recursive:true});
    const nonce = randomUUID();
    const lock = join(root,"campaign.lock");
    let fd: number;
    try { fd=openSync(lock,"wx",0o600); } catch { return fail("another executor or stale lock exists"); }
    try { writeSync(fd,nonce); fsyncSync(fd); } finally { closeSync(fd); }
    const ledger = new ScopedXhsCampaignLedger(root,config,now,nonce);
    try {
      const path=join(root,"campaign-ledger.jsonl");
      if (!existsSync(path)) ledger.append({kind:"header",configSha256:sha(JSON.stringify(config))});
      else ledger.replay(readFileSync(path,"utf8"));
      return ledger;
    } catch(error) { ledger.close(); throw error; }
  }

  private append(input: Pick<Entry,"kind"> & Partial<Pick<Entry,"configSha256"|"binding"|"slot"|"stage"|"externalId">>): void {
    if (this.closed) fail("ledger closed");
    const row: Omit<Entry,"digest">={seq:this.sequence+1,prev:this.previousDigest,kind:input.kind,at:new Date(this.now()).toISOString(),...(input.configSha256?{configSha256:input.configSha256}:{}),...(input.binding?{binding:input.binding}:{}),...(input.slot?{slot:input.slot}:{}),...(input.stage?{stage:input.stage}:{}),...(input.externalId?{externalId:input.externalId}:{})};
    const entry={...row,digest:digest(row)};
    this.validate(entry);
    const fd=openSync(join(this.root,"campaign-ledger.jsonl"),"a",0o600);
    try { writeSync(fd,JSON.stringify(entry)+"\n"); fsyncSync(fd); } finally { closeSync(fd); }
    this.apply(entry);
  }

  private replay(raw: string): void {
    if (!raw.endsWith("\n")) fail("ledger partial write");
    const lines=raw.trimEnd().split("\n");
    if (!lines.length) fail("ledger empty");
    for (const line of lines) {
      let entry: Entry;
      try { entry=JSON.parse(line) as Entry; } catch { return fail("ledger invalid JSON"); }
      const {digest: actual,...rest}=entry;
      if (actual!==digest(rest) || entry.seq!==this.sequence+1 || entry.prev!==this.previousDigest) fail("ledger chain mismatch");
      this.apply(entry);
    }
    if (this.sequence<1) fail("ledger header missing");
  }

  private apply(entry: Entry): void {
    this.validate(entry);
    if (entry.kind==="reserve") this.states.set(entry.binding!.slot,{stage:"slotReserved",binding:entry.binding!});
    if (entry.kind==="mark") {
      const state=this.states.get(entry.slot!)!;
      state.stage=entry.stage!;
      if (entry.externalId) state.externalId=entry.externalId;
    }
    this.sequence=entry.seq;this.previousDigest=entry.digest;
  }

  private validate(entry: Entry): void {
    if (entry.seq===1) {
      if (entry.kind!=="header" || entry.configSha256!==sha(JSON.stringify(this.config))) fail("campaign identity mismatch");
    } else if (entry.kind==="reserve") {
      const b=entry.binding;
      if (!b || this.states.has(b.slot) || !this.expectedContent(b)) fail("invalid slot reservation");
    } else if (entry.kind==="mark") {
      const state=entry.slot?this.states.get(entry.slot):undefined;
      if (!state || !entry.stage || state.stage==="published" || state.stage==="unknown") fail("invalid stage transition");
      const order:ScopedCampaignStage[]=["slotReserved","finalBoundaryClaimed","mouseActionInvoked","requestObserved","platformAccepted","published"];
      if (entry.stage!=="unknown" && order.indexOf(entry.stage)<=order.indexOf(state.stage)) fail("stage not advancing");
      if ((entry.stage==="platformAccepted" || entry.stage==="published") && !entry.externalId && !state.externalId) fail("external ID required");
      if (entry.externalId && state.externalId && entry.externalId!==state.externalId) fail("external ID conflict");
    } else fail("unexpected header");
  }

  private expectedContent(b: ScopedCampaignBinding): boolean {
    const item=this.config.content.find(x=>x.slot===b.slot);
    return !!item && b.accountId===this.config.accountId && b.creatorId===this.config.creatorId && b.titleSha256===item.titleSha256 && b.bodySha256===item.bodySha256 && b.imageSha256===item.imageSha256 && !!b.jobId && !!b.intentId && !!b.snapshotId && !!b.buildSha256;
  }
  reserve(binding: ScopedCampaignBinding): void {
    if (this.now()>=Date.parse(this.config.expiresAtUtc)) fail("authorization expired");
    if (!this.expectedContent(binding) || this.states.has(binding.slot)) fail("slot, subject or approved content mismatch");
    const index=this.config.content.findIndex(x=>x.slot===binding.slot);
    if (index<0 || this.config.content.slice(0,index).some(x=>this.states.get(x.slot)?.stage!=="published")) fail("prior slot not reliably published");
    if ([...this.states.values()].some(x=>x.stage==="unknown")) fail("campaign halted after Unknown");
    this.append({kind:"reserve",binding});
  }
  mark(slot: string, stage: ScopedCampaignStage, evidence?: {externalId?: string}): void {
    if (stage==="slotReserved") fail("reserve method required");
    this.append({kind:"mark",slot,stage,...(evidence?.externalId?{externalId:evidence.externalId}:{})});
  }
  snapshot(): { campaignId:string; slots:Record<string,SlotState>; reservedCount:number; expired:boolean } {
    const slots=Object.fromEntries(this.states) as Record<string,SlotState>;
    return {campaignId:this.config.campaignId,slots,reservedCount:this.states.size,expired:this.now()>=Date.parse(this.config.expiresAtUtc)};
  }
  assertDatabaseConsistency(intents:Array<{jobId:string;intentId:string;finalSubmitCount:number}>):void {
    const byJob=new Map([...this.states.values()].map(s=>[s.binding.jobId,s]));
    for(const intent of intents) if(intent.finalSubmitCount>0){const slot=byJob.get(intent.jobId);if(!slot || slot.binding.intentId!==intent.intentId || slot.stage==="slotReserved") fail("DB has a final claim absent from campaign ledger");}
    for(const slot of this.states.values()) if(slot.stage!=="slotReserved" && !intents.some(i=>i.jobId===slot.binding.jobId && i.intentId===slot.binding.intentId && i.finalSubmitCount>0)) fail("ledger final claim absent from DB");
  }
  close():void {
    if(this.closed)return;
    this.closed=true;
    const lock=join(this.root,"campaign.lock");
    try {if(readFileSync(lock,"utf8")===this.lockNonce) unlinkSync(lock);} catch { /* crash-safe stale lock remains */ }
  }
}
