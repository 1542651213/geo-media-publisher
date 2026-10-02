import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FactsTab } from '../apps/desktop/src/renderer/OperationsCenter';

it('offers an explicit review action for an imported unapproved fact',()=>{
  const html=renderToStaticMarkup(createElement(FactsTab,{companyId:'synthetic-company',busy:false,onAction:async()=>{},rows:[{id:'imported-fact',companyId:'synthetic-company',category:'公司信息',statement:'合成导入事实',source:'Manual',sourceDate:null,verifiedAt:null,expiresAt:null,approvedForAI:false,notes:'',createdAt:'2026-10-03',updatedAt:'2026-10-03'}]}));
  expect(html).toContain('未批准供 AI 使用');
  expect(html).toContain('核对并编辑');
});
