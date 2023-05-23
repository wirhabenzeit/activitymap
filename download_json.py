from firebase_admin import db, initialize_app, get_app
import pandas as pd
from shapely import wkt
import geopandas as gpd
import polyline

def download_json():
    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    df=pd.DataFrame.from_dict(ref.get(),orient="index")
    df.loc[df.geometry.notnull(),"geometry"] = df[df.geometry.notnull()].geometry.apply(wkt.loads)
    gdf = gpd.GeoDataFrame(df[df.geometry.notnull()], geometry="geometry")
    gdf["geometry"] = gdf.geometry.apply(lambda x: x.simplify(0.001, preserve_topology=False))
    gdf = gdf[["name","total_elevation_gain","distance","elapsed_time","start_date_local","geometry","type"]]
    gdf.to_file("public/strava.geojson", driver="GeoJSON")
    gdf.to_file("public/strava.shp")

if __name__ == "__main__":
    download_json()