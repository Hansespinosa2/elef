var k=`# New slide

Start writing here.`;function A(n,t,i){let e=t||[],r=k;if(i>=e.length)return n.trim()===""?r:`${n}${n.endsWith(`
`)?"":`
`}---
${r}`;let o=e[i]?.range;if(!o)throw new TypeError("Slide insertion needs the target slide range.");let l=o.start;return`${n.slice(0,l)}${r}
---
${n.slice(l)}`}function M(n,t,i){let e=t||[],r=e[i];if(!r||e.length<2)return null;let s=r.range;if(!s)return null;let o,l;if(i===0)o=s.start,l=r.delimiter_range?.end||s.end;else if(i===e.length-1){let d=e[i-1]?.delimiter_range;if(!d)return null;o=d.start,l=s.end}else o=s.start,l=r.delimiter_range?.end||s.end;return`${n.slice(0,o)}${n.slice(l)}`}function W(n,t,i,e){let r=t?.slides||[];if(!r[i]||e<0||e>=r.length)return null;let s=t?.front_matter?.range?.end||0,o=[];for(let a of r){let u=a.range;if(!u)return null;let g=n.slice(u.start,u.end),h=g.match(/\s*$/)?.[0]||"";o.push({body:g.slice(0,g.length-h.length),trailing:h})}let l=[];for(let[a,u]of r.slice(0,-1).entries()){let g=o[a],h=u.delimiter_range;if(!g||!h)return null;l.push(`${g.trailing}${n.slice(h.start,h.end)}`)}let f=o.at(-1);if(!f)return null;let d=f.trailing,m=o.splice(i,1)[0];if(!m)return null;o.splice(e,0,m);let p=o.map((a,u)=>`${a.body}${l[u]||""}`).join("");return`${n.slice(0,s)}${p}${d}`}function x(n,t){if(!t)throw new TypeError("Block operations need a block.");let i=t.range;if(!i)throw new TypeError("Block operations need a block range.");return t.position_scope!=="block"||!t.position_directive_id?i.start:n?.directives?.find(r=>r.id===t.position_directive_id)?.range?.start??i.start}function E(n,t){if(!n||!t)return null;let i=n.range;if(!i)return null;let e=x(t,n),r=i.end;if(n.position_scope==="group"&&(t.blocks||[]).filter(o=>o.position_directive_id===n.position_directive_id).length===1){let o=t.directives||[],l=o.findIndex(a=>a.id===n.position_directive_id),f=l>=0?o[l]:void 0,d=o.slice(l+1).find(a=>a.type==="position_close"),m=f?.range,p=d?.range;m&&p&&(e=m.start,r=p.end)}return{from:e,to:r}}function D(n,t,i){if(!t)return null;let e=t.blocks||[],r=t.range;if(!r)return null;let s=i<e.length?e[i]:void 0;if(i<e.length&&!s)return null;let o=s?x(t,s):r.end;if(i<e.length)return`${n.slice(0,o)}New block

${n.slice(o)}`;let l=n.slice(0,o),f=l.trim()===""?"":l.endsWith(`
`)?`
`:`

`,d=t.delimiter_range?`
`:"";return`${n.slice(0,o)}${f}New block${d}${n.slice(o)}`}function I(n,t,i){if(!t||!i)return null;let e=E(i,t);if(!e)return null;let r=n.slice(0,e.from),s=n.slice(e.to);return(r.trim()===""&&s.startsWith(`
`)||s.startsWith(`
`)&&r.endsWith(`

`))&&(s=s.slice(1)),`${r}${s}`}function N(n,t,i,e){if(!t||e<0||e>=(t.blocks||[]).length)return null;let r=t.blocks||[],s=t.range;if(!s)return null;let o=[];for(let c of r){if(!c.range)return null;o.push({block:c,range:c.range})}let l=r[i],f=l?.position_scope==="group"?l.position_directive_id:null,d=Math.min(i,e),m=Math.max(i,e);if(r.slice(d,m+1).some(c=>c.position_scope==="group"&&c.position_directive_id!==f)||f&&r.slice(d,m+1).some(c=>c.position_scope!=="group"||c.position_directive_id!==f))return null;let p=[],a=[],u=null,g=0;for(let{block:c,range:b}of o){let $=x(t,c),R=n.slice(b.start,b.end).match(/\r\n|\n|\r$/)?.[0]||"",_=b.end-R.length;p.push(n.slice($,_)),u===null?u=$:a.push(n.slice(g,$)),g=_}if(u===null)return null;let h=n.slice(g,s.end),S=n.slice(s.start,u),v=p.splice(i,1)[0];if(v===void 0)return null;p.splice(e,0,v);let T=`${S}${p.map((c,b)=>`${c}${a[b]||""}`).join("")}${h}`;return`${n.slice(0,s.start)}${T}${n.slice(s.end)}`}function L(n){if(!n)return{horizontal:"left",vertical:"top",verticalExplicit:!1};let t=n.trim().split(/\s+/),i="top",e="left";if(t.length===1){let r=t[0]??"";["left","center","right"].includes(r)?e=r:["top","middle","bottom"].includes(r)&&(i=r)}else if(t.length>=2){let r=t[0]??"",s=t[1]??"";i=r==="center"?"middle":r,e=s}return{horizontal:e,vertical:i,verticalExplicit:i!=="top"}}function O(n,t,i){let e=i,r=n.slice(t,e).match(/(?:\r\n|\r|\n)$/)?.[0];if(!r){let s=n.slice(e).match(/^(?:\r\n|\r|\n)/)?.[0];s?(e+=s.length,r=s):r=`
`}return{from:t,to:e,lineEnding:r}}function z(n,t,i){let e=n.match(/\r\n|\r|\n/)?.[0]||`
`,r=`${i}${e}${e}`;return{updated:`${n.slice(0,t)}${r}${n.slice(t)}`,replacement:r,lineEnding:e}}function y(n,t){let i=t.end,e=n.slice(0,t.start);if(!n.slice(t.start,i).match(/(?:\r\n|\r|\n)$/)?.[0]){let o=n.slice(i).match(/^(?:\r\n|\r|\n)/)?.[0];o&&(i+=o.length)}let s=n.slice(i);return e.endsWith(`

`)&&s.startsWith(`
`)&&(s=s.slice(1)),{updated:`${e}${s}`,to:i}}function C(n,t){return[...t].sort((i,e)=>e.start-i.start).reduce((i,e)=>y(i,e).updated,n)}function j(n){let t=[];return{text:n.replace(/\$\{(\d+)(?::([^}]*))?\}/g,(e,r,s="")=>{let o=w(n,t);return t.push({number:Number(r),start:o,length:s.length}),s}),stops:t.sort((e,r)=>e.number===0?1:r.number===0?-1:e.number-r.number)}}function w(n,t){let i=[...n.matchAll(/\$\{\d+(?::[^}]*)?\}/g)],e=i[t.length];return!e||e.index===void 0?n.length:e.index-t.reduce((r,s,o)=>r+(i[o]?.[0].length??0)-s.length,0)}function G(n,t,i){let e=n.slice(0,t.from),r=n.slice(t.to),s=e.length===0||/\n\n$/.test(e)?"":/\n$/.test(e)?`
`:`

`,o=r.length===0||/^\n\n/.test(r)?"":/^\n/.test(r)?`
`:`

`;return`${s}${i}${o}`}export{A as addSlide,E as blockOperationRange,x as blockOperationStart,M as deleteSlide,O as directiveLineSpan,y as exciseRange,C as exciseRanges,j as expandSnippet,z as insertAlignDirective,D as insertBlock,G as mediaInsertText,N as moveBlock,W as moveSlide,L as parseAlignment,I as removeBlock};
