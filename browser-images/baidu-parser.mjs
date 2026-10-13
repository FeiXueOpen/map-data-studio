const mapping = Object.fromEntries([...('0123456789abcdefghijklmnopqrstuvw')].map((c,i)=>[c,'7dgjmoru140852vsnkheb963wtqplifca'[i]]))
export function decodeBaiduUrl(value) {
 if(typeof value!=='string')return ''
 if(/^https?:\/\//i.test(value))return value
 if(!value.includes('_z2C$q'))return ''
 return value.replaceAll('_z2C$q',':').replaceAll('_z&e3B','.').replaceAll('AzdH3F','/').replace(/[0-9a-w]/g,c=>mapping[c] || c)
}
export function publicImageUrl(value){
 try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}
}
export function parseBaiduImages(payload){
 return (Array.isArray(payload?.data)?payload.data:[]).flatMap(item=>{
  const replacements=Array.isArray(item.replaceUrl)?item.replaceUrl:[]
  const url = publicImageUrl(replacements.find(v=>publicImageUrl(v.ObjURL))?.ObjURL || decodeBaiduUrl(item.objURL))
  if(!url)return []
  const page=publicImageUrl(replacements.find(v=>publicImageUrl(v.FromURL))?.FromURL || decodeBaiduUrl(item.fromURL) || item.fromURLHost)
  return [{url,page}]
 })
}
