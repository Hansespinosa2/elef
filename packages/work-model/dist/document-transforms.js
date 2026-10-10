var R=`# New slide

Start writing here.`;function D(n,t,i){let e=t||[],r=R;if(i>=e.length)return n.trim()===""?r:`${n}${n.endsWith(`
`)?"":`
`}---
${r}`;let o=e[i]?.range;if(!o)throw new TypeError("Slide insertion needs the target slide range.");let l=o.start;return`${n.slice(0,l)}${r}
---
${n.slice(l)}`}function I(n,t,i){let e=t||[],r=e[i];if(!r||e.length<2)return null;let s=r.range;if(!s)return null;let o,l;if(i===0)o=s.start,l=r.delimiter_range?.end||s.end;else if(i===e.length-1){let u=e[i-1]?.delimiter_range;if(!u)return null;o=u.start,l=s.end}else o=s.start,l=r.delimiter_range?.end||s.end;return`${n.slice(0,o)}${n.slice(l)}`}function M(n,t,i,e){let r=t?.slides||[];if(!r[i]||e<0||e>=r.length)return null;let s=t?.front_matter?.range?.end||0,o=[];for(let g of r){let f=g.range;if(!f)return null;let d=n.slice(f.start,f.end),p=d.match(/\s*$/)?.[0]||"";o.push({body:d.slice(0,d.length-p.length),trailing:p})}let l=[];for(let[g,f]of r.slice(0,-1).entries()){let d=o[g],p=f.delimiter_range;if(!d||!p)return null;l.push(`${d.trailing}${n.slice(p.start,p.end)}`)}let a=o.at(-1);if(!a)return null;let u=a.trailing,m=o.splice(i,1)[0];if(!m)return null;o.splice(e,0,m);let h=o.map((g,f)=>`${g.body}${l[f]||""}`).join("");return`${n.slice(0,s)}${h}${u}`}function x(n,t){if(!t)throw new TypeError("Block operations need a block.");let i=t.range;if(!i)throw new TypeError("Block operations need a block range.");let e=[i.start],r=t.art?.source_range?.start;if(Number.isInteger(r)&&e.push(r),t.position_scope==="block"&&t.position_directive_id){let o=n?.directives?.find(l=>l.id===t.position_directive_id)?.range?.start;Number.isInteger(o)&&e.push(o)}return Math.min(...e)}function k(n,t){return(n||[]).slice(t+1).find(i=>i.type==="position_close")}function y(n,t){if(!n||!t)return null;let i=n.range;if(!i)return null;let e=x(t,n),r=i.end;if(n.position_scope==="group"&&(t.blocks||[]).filter(o=>o.position_directive_id===n.position_directive_id).length===1){let o=t.directives||[],l=o.findIndex(m=>m.id===n.position_directive_id),a=l>=0?o[l]:void 0,u=k(o,l);a?.range&&(e=a.range.start),u?.range&&(r=u.range.end)}return{from:e,to:r}}function W(n,t,i){if(!t)return null;let e=t.blocks||[],r=t.range;if(!r)return null;let s=i<e.length?e[i]:void 0;if(i<e.length&&!s)return null;let o=s?x(t,s):r.end;if(i<e.length)return`${n.slice(0,o)}New block

${n.slice(o)}`;let l=n.slice(0,o),a=l.trim()===""?"":l.endsWith(`
`)?`
`:`

`,u=t.delimiter_range?`
`:"";return`${n.slice(0,o)}${a}New block${u}${n.slice(o)}`}function N(n,t,i){if(!t||!i)return null;let e=y(i,t);if(!e)return null;let r=n.slice(0,e.from),s=n.slice(e.to);return(r.trim()===""&&s.startsWith(`
`)||s.startsWith(`
`)&&r.endsWith(`

`))&&(s=s.slice(1)),`${r}${s}`}function L(n,t,i,e){if(!t||e<0||e>=(t.blocks||[]).length)return null;let r=t.blocks||[],s=t.range;if(!s)return null;let o=[];for(let c of r){if(!c.range)return null;o.push({block:c,range:c.range})}let l=r[i],a=l?.position_scope==="group"?l.position_directive_id:null,u=Math.min(i,e),m=Math.max(i,e);if(r.slice(u,m+1).some(c=>c.position_scope==="group"&&c.position_directive_id!==a)||a&&r.slice(u,m+1).some(c=>c.position_scope!=="group"||c.position_directive_id!==a))return null;let h=[],g=[],f=null,d=0;for(let{block:c,range:b}of o){let $=x(t,c),E=n.slice(b.start,b.end).match(/\r\n|\n|\r$/)?.[0]||"",_=b.end-E.length;h.push(n.slice($,_)),f===null?f=$:g.push(n.slice(d,$)),d=_}if(f===null)return null;let p=n.slice(d,s.end),S=n.slice(s.start,f),v=h.splice(i,1)[0];if(v===void 0)return null;h.splice(e,0,v);let T=`${S}${h.map((c,b)=>`${c}${g[b]||""}`).join("")}${p}`;return`${n.slice(0,s.start)}${T}${n.slice(s.end)}`}function O(n){if(!n)return{horizontal:"left",vertical:"top",verticalExplicit:!1};let t=n.trim().split(/\s+/),i="top",e="left";if(t.length===1){let r=t[0]??"";["left","center","right"].includes(r)?e=r:["top","middle","bottom"].includes(r)&&(i=r)}else if(t.length>=2){let r=t[0]??"",s=t[1]??"";i=r==="center"?"middle":r,e=s}return{horizontal:e,vertical:i,verticalExplicit:i!=="top"}}function C(n,t,i){let e=i,r=n.slice(t,e).match(/(?:\r\n|\r|\n)$/)?.[0];if(!r){let s=n.slice(e).match(/^(?:\r\n|\r|\n)/)?.[0];s?(e+=s.length,r=s):r=`
`}return{from:t,to:e,lineEnding:r}}function z(n,t,i){let e=n.match(/\r\n|\r|\n/)?.[0]||`
`,r=`${i}${e}${e}`;return{updated:`${n.slice(0,t)}${r}${n.slice(t)}`,replacement:r,lineEnding:e}}function w(n,t){let i=t.end,e=n.slice(0,t.start);if(!n.slice(t.start,i).match(/(?:\r\n|\r|\n)$/)?.[0]){let o=n.slice(i).match(/^(?:\r\n|\r|\n)/)?.[0];o&&(i+=o.length)}let s=n.slice(i);return e.endsWith(`

`)&&s.startsWith(`
`)&&(s=s.slice(1)),{updated:`${e}${s}`,to:i}}function j(n,t){return[...t].sort((i,e)=>e.start-i.start).reduce((i,e)=>w(i,e).updated,n)}function G(n){let t=[];return{text:n.replace(/\$\{(\d+)(?::([^}]*))?\}/g,(e,r,s="")=>{let o=B(n,t);return t.push({number:Number(r),start:o,length:s.length}),s}),stops:t.sort((e,r)=>e.number===0?1:r.number===0?-1:e.number-r.number)}}function B(n,t){let i=[...n.matchAll(/\$\{\d+(?::[^}]*)?\}/g)],e=i[t.length];return!e||e.index===void 0?n.length:e.index-t.reduce((r,s,o)=>r+(i[o]?.[0].length??0)-s.length,0)}function K(n,t,i){let e=n.slice(0,t.from),r=n.slice(t.to),s=e.length===0||/\n\n$/.test(e)?"":/\n$/.test(e)?`
`:`

`,o=r.length===0||/^\n\n/.test(r)?"":/^\n/.test(r)?`
`:`

`;return`${s}${i}${o}`}export{D as addSlide,y as blockOperationRange,x as blockOperationStart,I as deleteSlide,C as directiveLineSpan,w as exciseRange,j as exciseRanges,G as expandSnippet,k as findPositionCloseAfter,z as insertAlignDirective,W as insertBlock,K as mediaInsertText,L as moveBlock,M as moveSlide,O as parseAlignment,N as removeBlock};
