import { mkdir,writeFile,rename,unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Publish a complete content-addressed module before any importer can see it. */
export async function atomicImport(path,bytes){
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,path);}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return import(pathToFileURL(path).href);
}
