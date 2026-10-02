import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { openDatabase } from '@publisher/db';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('pages the complete company dataset with bounded quality reads and no foreign status',()=>{
  const root=mkdtempSync(join(tmpdir(),'r115-g-article-page-'));roots.push(root);
  const {db,repository}=openDatabase(join(root,'publisher.db'),resolve('packages/db/migrations'));
  try{
    const a=repository.createBrand({name:'分页甲',companyName:'分页合成甲有限公司'}),b=repository.createBrand({name:'分页乙',companyName:'分页合成乙有限公司'});
    const ids:string[]=[];
    for(let i=0;i<121;i++){
      const article=repository.createArticle({brandId:i===120?b.id:a.id,title:'合成稿'+i,body:'合成隔离分页正文',topic:'合成',keyword:'',city:'苏州',summary:'',tags:[],seoKeywords:[],articleType:'article',aiProvider:'manual',aiModel:'fixture',generatedAt:'fixture',reusePolicy:'once',contentHash:'paging-'+i,source:'excel_import'});
      if(!article)throw new Error('fixture required');ids.push(article.id);
      db.prepare("UPDATE content_quality_states SET status='Approved' WHERE content_id=?").run(article.id);
    }
    const prepared=vi.spyOn(db,'prepare');
    const first=repository.listArticlesPage({brandId:a.id,page:1,pageSize:50});
    expect(first.total).toBe(120);expect(first.totalPages).toBe(3);expect(first.items).toHaveLength(50);
    expect(Object.keys(first.qualityStatuses)).toEqual(first.items.map(article=>article.id));
    expect(Object.values(first.qualityStatuses)).toEqual(Array(50).fill('Approved'));
    expect(first.qualityStatuses[ids[120]!]).toBeUndefined();
    expect(prepared.mock.calls.length).toBeLessThanOrEqual(3);prepared.mockRestore();
    const pages=[first,repository.listArticlesPage({brandId:a.id,page:2,pageSize:50}),repository.listArticlesPage({brandId:a.id,page:3,pageSize:50})];
    expect(new Set(pages.flatMap(page=>page.items.map(article=>article.id))).size).toBe(120);
    expect(repository.listArticlesPage({brandId:a.id,page:1,pageSize:50}).items.map(article=>article.id)).toEqual(first.items.map(article=>article.id));
    repository.updateArticle(first.items[0]!.id,{body:'修改后的合成正文'});
    expect(repository.listArticlesPage({brandId:a.id,page:1,pageSize:50}).qualityStatuses[first.items[0]!.id]).not.toBe('Approved');
    const empty=repository.listArticlesPage({brandId:a.id,search:'不存在的合成标题'});expect(empty.items).toEqual([]);expect(empty.qualityStatuses).toEqual({});
  }finally{db.close();}
});
