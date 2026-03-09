import{r as f,j as e}from"./iframe-DtiPFMsg.js";import{r as o}from"./storyData-Aj6Yk1gK.js";import"./preload-helper-Dp1pzeXC.js";function r({timestamp:M,className:k}){const[,b]=f.useState(0);f.useEffect(()=>{const c=setInterval(()=>{b(a=>a+1)},6e4);return()=>clearInterval(c)},[]);const R=c=>{const a=new Date(c);if(Number.isNaN(a.getTime()))return"Invalid date";const I=new Date().getTime()-a.getTime(),d=Math.floor(I/1e3),l=Math.floor(d/60),p=Math.floor(l/60),s=Math.floor(p/24),t=new Intl.RelativeTimeFormat("en",{numeric:"auto",style:"long"});if(d<60)return t.format(-d,"second");if(l<60)return t.format(-l,"minute");if(p<24)return t.format(-p,"hour");if(s<7)return t.format(-s,"day");if(s<30){const u=Math.floor(s/7);return t.format(-u,"week")}if(s<365){const u=Math.floor(s/30);return t.format(-u,"month")}const E=Math.floor(s/365);return t.format(-E,"year")};return e.jsx("span",{className:k,children:R(M)})}r.__docgenInfo={description:"",methods:[],displayName:"RelativeTime",props:{timestamp:{required:!0,tsType:{name:"string"},description:""},className:{required:!1,tsType:{name:"string"},description:""}}};const q={title:"Components/RelativeTime",component:r,tags:["autodocs"],args:{timestamp:o.thisHour},argTypes:{className:{control:!1}}},n={},i={render:()=>e.jsxs("div",{className:"storybook-surface",children:[e.jsxs("div",{className:"storybook-row",children:[e.jsx("strong",{children:"Just now"}),e.jsx(r,{timestamp:o.justNow})]}),e.jsxs("div",{className:"storybook-row",children:[e.jsx("strong",{children:"This hour"}),e.jsx(r,{timestamp:o.thisHour})]}),e.jsxs("div",{className:"storybook-row",children:[e.jsx("strong",{children:"Yesterday"}),e.jsx(r,{timestamp:o.yesterday})]}),e.jsxs("div",{className:"storybook-row",children:[e.jsx("strong",{children:"Last month"}),e.jsx(r,{timestamp:o.lastMonth})]})]})},m={args:{timestamp:"definitely-not-a-date"}};var v,h,g;n.parameters={...n.parameters,docs:{...(v=n.parameters)==null?void 0:v.docs,source:{originalSource:"{}",...(g=(h=n.parameters)==null?void 0:h.docs)==null?void 0:g.source}}};var y,T,x;i.parameters={...i.parameters,docs:{...(y=i.parameters)==null?void 0:y.docs,source:{originalSource:`{
  render: () => <div className="storybook-surface">\r
      <div className="storybook-row">\r
        <strong>Just now</strong>\r
        <RelativeTime timestamp={relativeTimestamps.justNow} />\r
      </div>\r
      <div className="storybook-row">\r
        <strong>This hour</strong>\r
        <RelativeTime timestamp={relativeTimestamps.thisHour} />\r
      </div>\r
      <div className="storybook-row">\r
        <strong>Yesterday</strong>\r
        <RelativeTime timestamp={relativeTimestamps.yesterday} />\r
      </div>\r
      <div className="storybook-row">\r
        <strong>Last month</strong>\r
        <RelativeTime timestamp={relativeTimestamps.lastMonth} />\r
      </div>\r
    </div>
}`,...(x=(T=i.parameters)==null?void 0:T.docs)==null?void 0:x.source}}};var w,j,N;m.parameters={...m.parameters,docs:{...(w=m.parameters)==null?void 0:w.docs,source:{originalSource:`{
  args: {
    timestamp: 'definitely-not-a-date'
  }
}`,...(N=(j=m.parameters)==null?void 0:j.docs)==null?void 0:N.source}}};const A=["MinutesAgo","MixedExamples","InvalidTimestamp"];export{m as InvalidTimestamp,n as MinutesAgo,i as MixedExamples,A as __namedExportsOrder,q as default};
