// supabase/functions/finalizar-reunion/index.ts
// Desplegar con autenticación JWT activada. NO copiar secret/service_role al cliente.
// La función SQL purga los datos de reunión de forma transaccional, limitada al organizador.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const headers = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
  if(request.method==='OPTIONS') return new Response('',{status:204,headers});
  if(request.method!=='POST') return new Response(JSON.stringify({error:'Método no permitido'}),{status:405,headers});
  try {
    const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(!jwt) return new Response(JSON.stringify({error:'Sesión no autenticada'}),{status:401,headers});
    const url=Deno.env.get('SUPABASE_URL')!;
    const pub=Deno.env.get('SUPABASE_ANON_KEY')!;
    const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if(!url||!pub||!secret) throw new Error('Faltan variables de entorno');
    const userClient=createClient(url,pub,{global:{headers:{Authorization:'Bearer '+jwt}}});
    const {data:{user},error:authError}=await userClient.auth.getUser(jwt);
    if(authError||!user) return new Response(JSON.stringify({error:'Identidad inválida'}),{status:401,headers});
    const {session_id,confirm_export}=await request.json();
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(session_id||''))||confirm_export!==true)
      return new Response(JSON.stringify({error:'Confirma la exportación e indica una sesión válida'}),{status:400,headers});
    const {data:orphanIds,error:purgeError}=await userClient.rpc('finish_and_purge_session',{p_session:session_id});
    if(purgeError) return new Response(JSON.stringify({error:purgeError.message}),{status:403,headers});
    const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
    const cleanupErrors=[];
    for(const id of (orphanIds||[])){
      // No borrar identidades permanentes; sólo cuentas anónimas creadas por Supabase.
      const {data,error}=await admin.auth.admin.getUserById(id);
      if(error){cleanupErrors.push('No se pudo verificar una identidad');continue;}
      if(data?.user?.is_anonymous===true){
        const del=await admin.auth.admin.deleteUser(id,false);
        if(del.error)cleanupErrors.push('No se pudo borrar una identidad anónima');
      }
    }
    return new Response(JSON.stringify({deleted:true,auth_cleanup_complete:cleanupErrors.length===0,warning:cleanupErrors.length?'Datos de reunión eliminados, pero quedan usuarios anónimos pendientes de depuración. Revisa logs seguros.':null}),{status:200,headers});
  }catch(e){console.error('Fin de sesión:',e);return new Response(JSON.stringify({error:'No se pudo finalizar la sesión'}),{status:500,headers});}
});
