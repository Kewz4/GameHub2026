import{r as u}from"./index.DYrVU9rO.js";var l={exports:{}},c={};/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var f;function E(){if(f)return c;f=1;var r=Symbol.for("react.transitional.element"),e=Symbol.for("react.fragment");function o(t,s,n){var a=null;if(n!==void 0&&(a=""+n),s.key!==void 0&&(a=""+s.key),"key"in s){n={};for(var i in s)i!=="key"&&(n[i]=s[i])}else n=s;return s=n.ref,{$$typeof:r,type:t,key:a,ref:s!==void 0?s:null,props:n}}return c.Fragment=e,c.jsx=o,c.jsxs=o,c}var d;function h(){return d||(d=1,l.exports=E()),l.exports}var j=h();/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T=r=>r.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),g=r=>r.replace(/^([A-Z])|[\s-_]+(\w)/g,(e,o,t)=>t?t.toUpperCase():o.toLowerCase()),p=r=>{const e=g(r);return e.charAt(0).toUpperCase()+e.slice(1)},v=(...r)=>r.filter((e,o,t)=>!!e&&e.trim()!==""&&t.indexOf(e)===o).join(" ").trim(),k=r=>{for(const e in r)if(e.startsWith("aria-")||e==="role"||e==="title")return!0};/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var A={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=u.forwardRef(({color:r="currentColor",size:e=24,strokeWidth:o=2,absoluteStrokeWidth:t,className:s="",children:n,iconNode:a,...i},C)=>u.createElement("svg",{ref:C,...A,width:e,height:e,stroke:r,strokeWidth:t?Number(o)*24/Number(e):o,className:v("lucide",s),...!n&&!k(i)&&{"aria-hidden":"true"},...i},[...a.map(([w,R])=>u.createElement(w,R)),...Array.isArray(n)?n:[n]]));/**
 * @license lucide-react v0.562.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=(r,e)=>{const o=u.forwardRef(({className:t,...s},n)=>u.createElement(_,{ref:n,iconNode:e,className:v(`lucide-${T(p(r))}`,`lucide-${r}`,t),...s}));return o.displayName=p(r),o};function x(r,e){const o=e.split(".");let t=r;for(const s of o){if(t==null||typeof t!="object")return e;t=t[s]}return typeof t=="string"?t:e}function L(r,e){return function(t,s){let n=x(r,t);if(n===t&&e&&(n=x(e,t)),s&&typeof n=="string")for(const[a,i]of Object.entries(s))n=n.replace(new RegExp(`\\{${a}\\}`,"g"),String(i));return n}}const m=u.createContext(void 0),y=({children:r,locale:e="en",translations:o})=>{const t=u.useMemo(()=>{if(o){const s=L(o);return{t:(n,a)=>s(n,a),locale:e}}return{t:(s,n)=>s,locale:e}},[e,o]);return j.jsx(m.Provider,{value:t,children:r})};function S(){const r=u.useContext(m);if(r===void 0){let e="en";if(typeof window<"u"){const t=window.location.pathname.split("/").filter(Boolean)[0];["ja","es"].includes(t)&&(e=t)}return{t:(o,t)=>o,locale:e}}return r}export{y as T,$ as c,j,S as u};
