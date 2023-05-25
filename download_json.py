from firebase_admin import db, initialize_app, get_app
import pandas as pd
from shapely import wkt
import geopandas as gpd
import json
import polyline

def download_json():
    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    df=pd.DataFrame.from_dict(ref.get(),orient="index")
    df=df[df.athlete == 11979218]
    df=df[df.geometry.notnull()]
    df.loc[df.geometry.notnull(),"geometry"] = df[df.geometry.notnull()].geometry.apply(wkt.loads)
    df["geometry"] = df.geometry.apply(lambda x: x.simplify(0.0001, preserve_topology=False))
    df = df[df.geometry.apply(lambda x: len(x.coords)) > 0]
    df["polyline"] = df.geometry.apply(lambda x: polyline.encode(x.coords,5,geojson=True))
    df.drop("geometry",axis=1,inplace=True)
    with open("activityConfig.json","r") as f:
        ac = json.load(f)
        afkeys=set(ac["activityFilters"].keys())
        allkeys=afkeys.union(ac["tableColumns"].keys())
        allkeys.add("polyline")
        allkeys.add("type")
        print(allkeys)
    df = df[list(allkeys)]
    df.to_json("public/polyline.json",orient="index",indent=2)

if __name__ == "__main__":
    download_json()