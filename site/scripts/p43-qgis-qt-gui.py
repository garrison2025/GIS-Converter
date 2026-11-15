#!/usr/bin/python3
"""P43 real QGIS desktop Qt GUI layer/canvas acceptance.

Uses *installed QGIS desktop*'s PyQGIS and Qt map canvas (Xvfb/offscreen), not
GDAL-only CLI, not a simulated map, and not a human clicking through QGIS.
Input files are exclusively synthetic files actually downloaded from the
GIS Converter browser fixture script plus native GDAL-generated inputs.
"""
import json
import os
from pathlib import Path
import sys
import time
import traceback

folder = Path(sys.argv[1] if len(sys.argv)>1 else 'p43-qgis-fixtures').resolve()
evidence = {
    'kind': 'p43-real-qgis-desktop-qt-gui',
    'status': 'FAILED',
    'engine': 'installed QGIS desktop with PyQGIS QgsMapCanvas',
    'physicalDevice': 'NOT_TESTED',
    'manualQgisInteraction': 'NOT_TESTED',
    'checks': [],
}
def require(ok, message):
    if not ok:
        raise AssertionError(message)

def check(name, callback):
    item = {'name':name,'status':'FAILED'}
    evidence['checks'].append(item)
    try:
        item.update(callback() or {})
        item['status']='PASSED'
    except Exception as error:
        item['error']=str(error)[:500]
        raise

try:
    os.environ.setdefault('QT_QPA_PLATFORM','offscreen')
    from qgis.core import QgsApplication, QgsProject, QgsVectorLayer, QgsWkbTypes
    from qgis.gui import QgsMapCanvas
    from qgis.PyQt.QtCore import Qt
    from qgis.PyQt.QtGui import QColor

    QgsApplication.setPrefixPath('/usr',True)
    app=QgsApplication([],True)
    app.initQgis()
    evidence['qgisVersion']=QgsApplication.qgisVersion() if hasattr(QgsApplication,'qgisVersion') else 'desktop PyQGIS'
    source_evidence=json.loads((folder/'browser-evidence.json').read_text(encoding='utf8'))
    require(source_evidence['status']=='PASSED','Browser-generated source evidence was not accepted')
    layers={}
    files={
        'browser_polygon':('p43-browser-polygon.shp',2,'EPSG:4326'),
        'native_cp1252':('p43-native-cp1252.shp',1,'EPSG:4326'),
        'browser_cp1252':('p43-browser-cp1252.geojson',1,'EPSG:4326'),
        'native_projected':('p43-native-epsg3857.shp',1,'EPSG:3857'),
        'browser_reprojected':('p43-browser-reprojected.geojson',1,'EPSG:4326')
    }
    for key,(basename,count,crs) in files.items():
        def validate(key=key,basename=basename,count=count,crs=crs):
            filename=folder/basename
            require(filename.exists(),'Expected actual input/output GIS file is missing')
            layer=QgsVectorLayer(str(filename),key,'ogr')
            require(layer.isValid(),'QGIS could not open '+basename)
            require(layer.featureCount()==count,
                'QGIS feature count differs for '+basename)
            require(layer.crs().authid()==crs,
                'QGIS CRS does not match expected '+crs+' for '+basename+
                ' got '+layer.crs().authid())
            require(len(list(layer.getFeatures()))==count,'QGIS iteration misses features')
            layers[key]=layer
            return {'featureCount':count,'detectedCRS':layer.crs().authid(),
                'provider':layer.providerType()}
        check('QGIS_gui_load_'+key,validate)
    def polygon_test():
        layer=layers['browser_polygon']
        require(layer.geometryType()==QgsWkbTypes.PolygonGeometry,
            'QGIS browser-generated Shapefile is not a polygon layer')
        parts=0
        holes=0
        area=0
        labels=set()
        for f in layer.getFeatures():
            labels.add(str(f['Label']))
            require(int(f['Count']) in (2,3),'QGIS lost numeric DBF value')
            g=f.geometry()
            require(g is not None and not g.isNull() and not g.isEmpty(),
                'QGIS cannot load saved polygon geometry')
            polygons=g.asMultiPolygon() if g.isMultipart() else [g.asPolygon()]
            for rings in polygons:
                require(len(rings)>=1,'QGIS polygon has no exterior ring')
                require(len(rings[0])>=4,'QGIS polygon ring was collapsed')
                parts+=1
                holes+=len(rings)-1
            area+=g.area()
        require(parts==3 and holes==1,'QGIS lost polygon island or interior hole')
        require(abs(area-20)<0.001,'QGIS detected incorrect polygon areas')
        require(labels=={'公园内环','两个岛屿'},
            'QGIS cannot decode browser-generated UTF-8 DBF attributes')
        return {'parts':parts,'interiorHoles':holes,'area':round(area,6),
            'utf8ChineseAttributes':True}
    check('QGIS_gui_polygon_parts_holes_utf8_and_geometry',polygon_test)
    def attributes():
        a=next(layers['native_cp1252'].getFeatures())
        b=next(layers['browser_cp1252'].getFeatures())
        require(str(a['Label'])=='Café Málaga' and str(b['Label'])=='Café Málaga',
            'QGIS CP1252 .cpg source or browser Unicode GeoJSON text corrupted')
        require(int(a['Code'])==31 and int(b['Code'])==31,'QGIS CP1252 numeric attribute lost')
        return {'nativeCodepage':'CP1252','browserEncoding':'UTF-8','matched':True}
    check('QGIS_gui_cp1252_cpg_and_converted_unicode',attributes)
    def reprojected():
        native=next(layers['native_projected'].getFeatures()).geometry().asPoint()
        out=next(layers['browser_reprojected'].getFeatures()).geometry().asPoint()
        require(abs(native.x())>1_000_000 and abs(native.y())>1_000_000,
            'Original projected QGIS layer does not have meter coordinates')
        require(abs(out.x()-116.4)<0.00011 and abs(out.y()-39.9)<0.00011,
            'Browser reprojected WGS84 file not correctly opened by QGIS')
        require(str(next(layers['browser_reprojected'].getFeatures())['Label'])=='原生投影',
            'QGIS lost projected output Chinese attribute')
        return {'sourceCRS':'EPSG:3857','outputCRS':'EPSG:4326',
            'reprojectedCoordinatesVerified':True}
    check('QGIS_gui_native_3857_to_browser_4326',reprojected)
    def desktop_canvas():
        project=QgsProject.instance()
        project.setCrs(layers['browser_polygon'].crs())
        for layer in layers.values():
            project.addMapLayer(layer,False)
        canvas=QgsMapCanvas()
        canvas.setCanvasColor(QColor('#ffffff'))
        canvas.resize(900,650)
        canvas.setLayers([layers['browser_polygon']])
        canvas.setExtent(layers['browser_polygon'].extent())
        canvas.show()
        canvas.refresh()
        deadline=time.monotonic()+14
        while time.monotonic()<deadline:
            app.processEvents()
            time.sleep(.08)
            if not canvas.isDrawing() and time.monotonic()+.1<deadline:
                break
        for _ in range(12):
            app.processEvents()
            time.sleep(.04)
        shot=folder/'p43-qgis-desktop-map.png'
        image=canvas.grab()
        require(not image.isNull(),'QGIS actual Qt map canvas could not be captured')
        require(image.width()>=800 and image.height()>=600,
            'QGIS Qt canvas screenshot is smaller than expected')
        require(image.save(str(shot),'PNG'),'Cannot save actual QGIS Qt GUI screenshot')
        require(shot.stat().st_size>2500,'QGIS Qt GUI screenshot contains too little data')
        canvas.hide()
        return {'mapCanvas':'QgsMapCanvas','screenshot':shot.name,
            'width':image.width(),'height':image.height(),
            'screenshotBytes':shot.stat().st_size}
    check('QGIS_actual_Qt_map_canvas_rendered_and_screenshot',desktop_canvas)
    evidence['status']='PASSED'
except Exception as error:
    evidence['error']=str(error)[:1000]
    evidence['traceback']=traceback.format_exc()[-1500:]
finally:
    try:
        (folder/'qgis-desktop-evidence.json').write_text(
            json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
    except Exception:
        pass
    print('P43_QGIS_GUI_SUMMARY '+json.dumps({
        'status':evidence['status'],'passed':sum(x['status']=='PASSED'
         for x in evidence['checks']),'expected':len(evidence['checks']),
        'physicalDevice':evidence['physicalDevice'],
        'manualQgisInteraction':evidence['manualQgisInteraction'],
        'error':evidence.get('error')},ensure_ascii=False))
    try:
        QgsProject.instance().clear()
        app.exitQgis()
    except Exception:
        pass
if evidence['status']!='PASSED':
    sys.exit(1)
