import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../content/developer-docs/assets');
const variants={
  en:{lang:'en',title:'Formal factory enrollment sequence',note:'This is the authorized mass-production flow. Cloud Test Lab is a simplified development test and must not be used for mass production.',actors:['Cloud owner','Platform operator','Factory gateway','Device','Factory enrollment service','Account Manager','Product issuer'],steps:[
    [2,1,'Submit factory CSR'],[1,2,'Issue factory client certificate'],[0,5,'Create Product production run'],[0,2,'Deliver batch JWT securely (shown once)'],[3,2,'Generate key locally; send device CSR'],[2,4,'mTLS + JWT + device CSR'],[4,5,'Check run, Cloud, Product and quota'],[4,6,'Sign using this Product issuer'],[6,2,'Return device certificate and chain'],[2,3,'Install certificate; retain device key']
  ]},
  'zh-TW':{lang:'zh-Hant',title:'正式工廠簽發時序圖',note:'這是經授權的量產流程。Cloud Test Lab 是簡化的開發測試流程，不可用於量產。',actors:['雲端管理者','平台管理員','工廠閘道','裝置','工廠簽發服務','帳戶管理服務','產品簽發者'],steps:[
    [2,1,'提交工廠 CSR'],[1,2,'簽發工廠用戶端憑證'],[0,5,'建立產品生產批次'],[0,2,'安全交付一次顯示的批次 JWT'],[3,2,'本機產生私鑰，交付裝置 CSR'],[2,4,'mTLS + JWT + 裝置 CSR'],[4,5,'檢查批次、雲端、產品與配額'],[4,6,'由此產品簽發者簽署'],[6,2,'回傳裝置憑證與憑證鏈'],[2,3,'安裝憑證；私鑰留在裝置']
  ]},
  'zh-CN':{lang:'zh-Hans',title:'正式工厂签发时序图',note:'这是经授权的量产流程。Cloud Test Lab 是简化的开发测试流程，不可用于量产。',actors:['云端管理员','平台管理员','工厂网关','设备','工厂签发服务','账户管理服务','产品签发者'],steps:[
    [2,1,'提交工厂 CSR'],[1,2,'签发工厂客户端证书'],[0,5,'创建产品生产批次'],[0,2,'安全交付仅显示一次的批次 JWT'],[3,2,'本地生成私钥，交付设备 CSR'],[2,4,'mTLS + JWT + 设备 CSR'],[4,5,'检查批次、云端、产品与配额'],[4,6,'由此产品签发者签署'],[6,2,'返回设备证书与证书链'],[2,3,'安装证书；私钥留在设备']
  ]}
};
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const x=i=>120+i*220;
for(const [locale,item] of Object.entries(variants)){
  const actors=item.actors.map((actor,i)=>`<rect x="${x(i)-96}" y="24" width="192" height="54" rx="8" fill="#fff" stroke="#244c78"/><text x="${x(i)}" y="56" text-anchor="middle" class="actor">${escape(actor)}</text><line x1="${x(i)}" y1="78" x2="${x(i)}" y2="806" class="lifeline"/>`).join('');
  const messages=item.steps.map(([from,to,label],i)=>{const y=128+i*68,a=x(from),b=x(to),direction=b>a?1:-1;return `<text x="${(a+b)/2}" y="${y-13}" text-anchor="middle" class="step">${escape(label)}</text><line x1="${a}" y1="${y}" x2="${b-direction*11}" y2="${y}" class="arrow"/><polygon points="${b},${y} ${b-direction*12},${y-6} ${b-direction*12},${y+6}" fill="#c65726"/>`;}).join('');
  const svg=`<svg viewBox="0 0 1560 830" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(item.title)}"><style>.actor{font:650 15px system-ui,sans-serif;fill:#213246}.step{font:13px system-ui,sans-serif;fill:#213246}.lifeline{stroke:#94a9bc;stroke-dasharray:5 5}.arrow{stroke:#c65726;stroke-width:2}</style><rect width="1560" height="830" fill="#fff"/>${actors}${messages}</svg>`;
  const html=`<!doctype html><html lang="${item.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(item.title)}</title><style>body{margin:0;background:#f4f8fc;color:#213246;font-family:system-ui,sans-serif}main{max-width:1580px;margin:auto;padding:24px}h1{font-size:clamp(1.5rem,3vw,2.3rem);margin:0 0 8px}.note{background:#fff4e9;border-left:4px solid #c65726;padding:12px 16px;line-height:1.5}.diagram{overflow-x:auto;background:white;border:1px solid #cad7e5;border-radius:10px;padding:12px}svg{min-width:1560px;width:100%;height:auto}</style></head><body><main><h1>${escape(item.title)}</h1><p class="note">${escape(item.note)}</p><div class="diagram">${svg}</div></main></body></html>\n`;
  const suffix=locale==='en'?'':`.${locale}`;
  await writeFile(resolve(root,`factory-enrollment-formal${suffix}.html`),html);
  await writeFile(resolve(root,`factory-enrollment-formal${suffix}.svg`),svg+'\n');
}
