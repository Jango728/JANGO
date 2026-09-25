"use client";
import {useState} from 'react';
import logos from '@/lib/promotion-logos.json';
export function PromotionLogo({promotion}:{promotion:string}){
 const [failed,setFailed]=useState(false),asset=(logos as Record<string,{path:string}>)[promotion];
 const token=promotion.toLowerCase().replace(/[^a-z0-9]+/g,'-');
 if(promotion==='DWCS')return <span className={`promotion-logo promotion-logo-${token}`} aria-label="Dana White's Contender Series"><span className="dwcs-mark"><b>UFC</b><em>DWCS</em></span></span>;
 return <span className={`promotion-logo promotion-logo-${token}`} aria-label={promotion}>{asset&&!failed?<img src={asset.path} alt="" onError={()=>setFailed(true)} width={72} height={30}/>:<span>{promotion}</span>}</span>;
}
