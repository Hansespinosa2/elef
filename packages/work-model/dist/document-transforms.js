var E=`# New slide

Start writing here.`;function B(n,t,i){let e=t||[],r=E;if(i>=e.length)return n.trim()===""?r:`${n}${n.endsWith(`
`)?"":`
`}---
${r}`;let s=e[i]?.range;if(!s)throw new TypeError("Slide insertion needs the target slide range.");let o=s.start;return`${n.slice(0,o)}${r}
---
${n.slice(o)}`}function w(n,t,i){let e=t||[],r=e[i];if(!r||e.length<2)return null;let l=r.range;if(!l)return null;let s,o;if(i===0)s=l.start,o=r.delimiter_range?.end||l.end;else if(i===e.length-1){let c=e[i-1]?.delimiter_range;if(!c)return null;s=c.start,o=l.end}else s=l.start,o=r.delimiter_range?.end||l.end;return`${n.slice(0,s)}${n.slice(o)}`}function A(n,t,i,e){let r=t?.slides||[];if(!r[i]||e<0||e>=r.length)return null;let l=t?.front_matter?.range?.end||0,s=[];for(let d of r){let u=d.range;if(!u)return null;let g=n.slice(u.start,u.end),a=g.match(/\s*$/)?.[0]||"";s.push({body:g.slice(0,g.length-a.length),trailing:a})}let o=[];for(let[d,u]of r.slice(0,-1).entries()){let g=s[d],a=u.delimiter_range;if(!g||!a)return null;o.push(`${g.trailing}${n.slice(a.start,a.end)}`)}let f=s.at(-1);if(!f)return null;let c=f.trailing,p=s.splice(i,1)[0];if(!p)return null;s.splice(e,0,p);let h=s.map((d,u)=>`${d.body}${o[u]||""}`).join("");return`${n.slice(0,l)}${h}${c}`}function x(n,t){if(!t)throw new TypeError("Block operations need a block.");let i=t.range;if(!i)throw new TypeError("Block operations need a block range.");let e=[i.start],r=t.art?.source_range?.start;if(Number.isInteger(r)&&e.push(r),t.position_directive_id){let s=n?.directives?.find(o=>o.id===t.position_directive_id)?.range?.start;Number.isInteger(s)&&e.push(s)}return Math.min(...e)}function k(n,t){if(!n||!t)return null;let i=n.range;if(!i)return null;let e=x(t,n),r=i.end;return{from:e,to:r}}function N(n,t,i){if(!t)return null;let e=t.blocks||[],r=t.range;if(!r)return null;let l=i<e.length?e[i]:void 0;if(i<e.length&&!l)return null;let s=l?x(t,l):r.end;if(i<e.length)return`${n.slice(0,s)}New block

${n.slice(s)}`;let o=n.slice(0,s),f=o.trim()===""?"":o.endsWith(`
`)?`
`:`

`,c=t.delimiter_range?`
`:"";return`${n.slice(0,s)}${f}New block${c}${n.slice(s)}`}function I(n,t,i){if(!t||!i)return null;let e=k(i,t);if(!e)return null;let r=n.slice(0,e.from),l=n.slice(e.to);return(r.trim()===""&&l.startsWith(`
`)||l.startsWith(`
`)&&r.endsWith(`

`))&&(l=l.slice(1)),`${r}${l}`}function L(n,t,i,e){if(!t||e<0||e>=(t.blocks||[]).length)return null;let r=t.blocks||[],l=t.range;if(!l)return null;let s=[];for(let a of r){if(!a.range)return null;s.push({block:a,range:a.range})}let o=[],f=[],c=null,p=0;for(let{block:a,range:m}of s){let b=x(t,a),v=n.slice(m.start,m.end).match(/\r\n|\n|\r$/)?.[0]||"",T=m.end-v.length;o.push(n.slice(b,T)),c===null?c=b:f.push(n.slice(p,b)),p=T}if(c===null)return null;let h=n.slice(p,l.end),d=n.slice(l.start,c),u=o.splice(i,1)[0];if(u===void 0)return null;o.splice(e,0,u);let g=`${d}${o.map((a,m)=>`${a}${f[m]||""}`).join("")}${h}`;return`${n.slice(0,l.start)}${g}${n.slice(l.end)}`}var S=["left","center","right"],$=["top","middle","bottom"];function W(n){if(!n)return{horizontal:"left",vertical:"top",verticalExplicit:!1};let t=n.trim().toLowerCase().split(/\s+/).filter(Boolean);if(t.length===0)return{horizontal:"left",vertical:"top",verticalExplicit:!1};if(t.length===1){let r=t[0]??"";return S.includes(r)?{horizontal:r,vertical:"top",verticalExplicit:!1}:$.includes(r)?{horizontal:"left",vertical:r,verticalExplicit:r!=="top"}:{horizontal:"left",vertical:"top",verticalExplicit:!1}}let i=t.find(r=>S.includes(r))??"left",e=t.find(r=>$.includes(r))??"top";return{horizontal:i,vertical:e,verticalExplicit:t.some(r=>$.includes(r))}}function D(n,t,i){let e=i,r=n.slice(t,e).match(/(?:\r\n|\r|\n)$/)?.[0];if(!r){let l=n.slice(e).match(/^(?:\r\n|\r|\n)/)?.[0];l?(e+=l.length,r=l):r=`
`}return{from:t,to:e,lineEnding:r}}function M(n,t,i){let e=n.match(/\r\n|\r|\n/)?.[0]||`
`,r=`${i}${e}${e}`;return{updated:`${n.slice(0,t)}${r}${n.slice(t)}`,replacement:r,lineEnding:e}}function R(n,t){let i=t.end,e=n.slice(0,t.start);if(!n.slice(t.start,i).match(/(?:\r\n|\r|\n)$/)?.[0]){let s=n.slice(i).match(/^(?:\r\n|\r|\n)/)?.[0];s&&(i+=s.length)}let l=n.slice(i);return e.endsWith(`

`)&&l.startsWith(`
`)&&(l=l.slice(1)),{updated:`${e}${l}`,to:i}}function z(n,t){return[...t].sort((i,e)=>e.start-i.start).reduce((i,e)=>R(i,e).updated,n)}function O(n){let t=[];return{text:n.replace(/\$\{(\d+)(?::([^}]*))?\}/g,(e,r,l="")=>{let s=_(n,t);return t.push({number:Number(r),start:s,length:l.length}),l}),stops:t.sort((e,r)=>e.number===0?1:r.number===0?-1:e.number-r.number)}}function _(n,t){let i=[...n.matchAll(/\$\{\d+(?::[^}]*)?\}/g)],e=i[t.length];return!e||e.index===void 0?n.length:e.index-t.reduce((r,l,s)=>r+(i[s]?.[0].length??0)-l.length,0)}function C(n,t,i){let e=n.slice(0,t.from),r=n.slice(t.to),l=e.length===0||/\n\n$/.test(e)?"":/\n$/.test(e)?`
`:`

`,s=r.length===0||/^\n\n/.test(r)?"":/^\n/.test(r)?`
`:`

`;return`${l}${i}${s}`}export{B as addSlide,k as blockOperationRange,x as blockOperationStart,w as deleteSlide,D as directiveLineSpan,R as exciseRange,z as exciseRanges,O as expandSnippet,M as insertAlignDirective,N as insertBlock,C as mediaInsertText,L as moveBlock,A as moveSlide,W as parseAlignment,I as removeBlock};
