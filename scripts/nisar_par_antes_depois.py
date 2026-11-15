# Par antes/depois a partir das imagens de preview (browse) do NISAR GCOV, sem login.
# Canais do preview em cenas HH+HV: vermelho e azul = HH, verde = HV.
# Teste, guardado como referência: posiciona pelo contorno do quadro no catálogo, que é aproximado.
# As imagens do app saem do scene_images.py, que posiciona pelo KML oficial e alinha as duas datas.
# Precisa de numpy e Pillow e do gran_<nome>.json gravado pelo nisar_passagens.py na pasta atual:
#   python scripts/nisar_par_antes_depois.py <nome> <stack> <data1> <data2> <lat> <lon> <meia_largura_graus>
#   (por exemplo: campinas 024_D_100 2026-06-27 2026-11-06 -23.0 -47.1 0.4)
# Grava <nome>_before.png, <nome>_after.png e <nome>_real.png (antes, depois e mudança) na pasta atual.
import json, sys, urllib.request, io, math
import numpy as np
from PIL import Image
name, stack, d1, d2, clat, clon, half = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
gs=[g for g in json.load(open(f"gran_{name}.json")) if g["stack"]==stack]
def load(d):
    g=[g for g in gs if g["date"]==d][0]
    a=np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(g["browse"],timeout=120).read())).convert("RGB"))
    v=a.sum(2)>0; ys=np.where(v.any(1))[0]; xs=np.where(v.any(0))[0]
    lons=[p[0] for p in g["poly"]]; lats=[p[1] for p in g["poly"]]
    return a,(xs[0],xs[-1],ys[0],ys[-1]),(min(lons),max(lons),min(lats),max(lats))
def crop(a,px,geo,bbox,size=640):
    w,s,e,n=bbox
    fx=lambda lon: px[0]+(lon-geo[0])/(geo[1]-geo[0])*(px[1]-px[0]); fy=lambda lat: px[2]+(geo[3]-lat)/(geo[3]-geo[2])*(px[3]-px[2])
    return Image.fromarray(a).crop((round(fx(w)),round(fy(n)),round(fx(e)),round(fy(s)))).resize((size,size),Image.LANCZOS)
def smooth(x,k=5):
    p=np.pad(x,k//2,mode="edge"); s=np.zeros_like(x)
    for i in range(k):
        for j in range(k): s+=p[i:i+x.shape[0], j:j+x.shape[1]]
    return s/(k*k)
bbox=(clon-half,clat-half,clon+half,clat+half)
c1=crop(*load(d1),bbox); c2=crop(*load(d2),bbox)
x=np.asarray(c1).astype(np.float32); y=np.asarray(c2).astype(np.float32); ok=(x.sum(2)>0)&(y.sum(2)>0)
dHH=10*np.log10((smooth(y[...,0])+1)/(smooth(x[...,0])+1)); dHV=10*np.log10((smooth(y[...,1])+1)/(smooth(x[...,1])+1))
area=(2*half*111.32)*(2*half*111.32*math.cos(math.radians(clat))); T=2.5
cls={"HH e HV cairam (agua, solo exposto)":(dHH<-T)&(dHV<-T),"so HV caiu (perda de vegetacao)":(dHV<-T)&(dHH>=-T),
     "so HH caiu":(dHH<-T)&(dHV>=-T),"HV subiu (vegetacao crescendo)":(dHV>T),"so HH subiu (umidade, rugosidade)":(dHH>T)&(dHV<=T)}
print(f"{name} {d1} -> {d2}  bbox {[round(v,3) for v in bbox]}  area {area:.0f} km2  validos {ok.mean()*100:.0f}%")
for k,m in cls.items(): print(f"  {k}: {(m&ok).mean()*100:.1f}%  ~{(m&ok).mean()*area:.0f} km2")
ov=(y*0.55).astype(np.uint8)
ov[(dHV>T)&ok]=[70,200,110]; ov[(dHH>T)&(dHV<=T)&ok]=[70,140,255]; ov[(dHV<-T)&(dHH>=-T)&ok]=[255,170,40]; ov[(dHH<-T)&ok]=[235,50,50]
out=Image.new("RGB",(640*3+20,640),(15,20,30)); out.paste(c1,(0,0)); out.paste(c2,(650,0)); out.paste(Image.fromarray(ov),(1300,0)); out.save(f"{name}_real.png")
c1.save(f"{name}_before.png"); c2.save(f"{name}_after.png")
