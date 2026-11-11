import { z } from 'zod';
const text = (max=200) => z.string().trim().max(max);
const name = text().min(1);
export const side = z.enum(['f','m','all']);
export const id = z.uuid();
export const credentials = z.object({login:text(120).min(1).transform(x=>x.toLowerCase()), password:z.string().min(1).max(256)});
export const registration = credentials.extend({name, password:z.string().min(8).max(256), token:z.string().min(20).max(100)});
export const kinds = z.enum(['person','directory','yahrzeit','simcha','learning']);
export const months = ['תשרי','חשון','כסלו','טבת','שבט','אדר','אדר א׳','אדר ב׳','ניסן','אייר','סיון','תמוז','אב','אלול'] as const;
export const schemas = {
 person:z.object({name, spouse:text().default(''), parentId:id.nullable().default(null), deceased:z.boolean().default(false)}).strict(),
 directory:z.object({husband:text(),wife:text(),address:text(500),phone:text(60),wifePhone:text(60),parents:text()}).strict().refine(x=>x.husband||x.wife,{message:'A name is required'}),
 yahrzeit:z.object({name,relationship:text(),day:z.number().int().min(1).max(30),month:z.enum(months),grave:text(500)}).strict(),
 simcha:z.object({title:name, host:name, date:z.iso.date(), time:text(20), venue:text(),address:text(500)}).strict(),
 learning:z.object({title:name,kind:z.enum(['tehillim','mishnayos']),deadline:z.iso.date()}).strict()
};
export const recordBody = z.object({kind:kinds,side,data:z.unknown()}).strict();
export const updateBody = z.object({version:z.number().int().positive(),data:z.unknown()}).strict();
export function allowed(user:{sides:string[]}, scope:string) { return scope==='all'||user.sides.includes(scope); }
