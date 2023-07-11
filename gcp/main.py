#from flask import escape, jsonify
#import os
#from shapely.geometry import LineString
import functions_framework
#from stravalib.client import Client
#import json
import pandas as pd
import geopandas as gpd
from shapely import wkt
from firebase_admin import db, initialize_app, get_app
#from google.cloud import secretmanager
#import polyline


@functions_framework.http
def strava_json(request):
    request_args = request.args
    if request_args and 'athlete' in request_args:
        athlete = request_args["athlete"]
    else:
        athlete = 6824046
    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    df=pd.DataFrame.from_dict(ref.get(),orient="index")
    df = df[df.athlete == int(athlete)]
    df=df[df.geometry.notnull()]
    df.loc[df.geometry.notnull(),"geometry"] = df[df.geometry.notnull()].geometry.apply(wkt.loads)
    df["geometry"] = df.geometry.apply(lambda x: x.simplify(0.0005, preserve_topology=False))
    df = df[df.geometry.apply(lambda x: len(x.coords)) > 0]
    gdf = gpd.GeoDataFrame(df, geometry="geometry")
    gdf["start_date_local"] = gdf["start_date_local"].apply(lambda x: pd.Timestamp(x).timestamp())
    if request_args and 'columns' in request_args:
        gdf = gdf[request_args["columns"].split(",")]
    gdf["id"] = gdf.index
    return gdf.__geo_interface__


@functions_framework.http
def strava_geojson(request):
    client = secretmanager.SecretManagerServiceClient()
    s_client=Client()
    client_id = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_client_id/versions/latest"}).payload.data.decode("UTF-8")
    client_secret = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_client_secret/versions/latest"}).payload.data.decode("UTF-8")
    request_args = request.args
    if request_args and 'athlete' in request_args:
        athlete = request_args["athlete"]
    else:
        athlete = 6824046
    old_rt = client.access_secret_version(request={"name": f"projects/stravamap-386413/secrets/strava_refresh_token_{athlete}/versions/latest"}).payload.data.decode("UTF-8")
    newcred = s_client.refresh_access_token(client_id=client_id,client_secret=client_secret,refresh_token=old_rt)

    response = client.add_secret_version(
        request={
            "parent": f"projects/stravamap-386413/secrets/strava_access_token_{athlete}",
            "payload": {"data": newcred["access_token"].encode("UTF-8") },
        }
    )
    response2 = client.add_secret_version(
        request={
            "parent": f"projects/stravamap-386413/secrets/strava_refresh_token_{athlete}",
                "payload": {"data": newcred["refresh_token"].encode("UTF-8") },
            }
        )
    # Build the resource name of the secret version

    oldrt=list(client.list_secret_versions(request={"parent": f"projects/stravamap-386413/secrets/strava_refresh_token_{athlete}"}))[1].name
    response3 = client.destroy_secret_version(request={"name": oldrt})
    oldat=list(client.list_secret_versions(request={"parent": f"projects/stravamap-386413/secrets/strava_access_token_{athlete}"}))[1].name
    response4 = client.destroy_secret_version(request={"name": oldat})
    print(response, response2, response3, response4)
    

    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    df=pd.DataFrame.from_dict(ref.get(),orient="index")
    df = df[df.athlete == int(athlete)]
    df=df[df.geometry.notnull()]
    df.loc[df.geometry.notnull(),"geometry"] = df[df.geometry.notnull()].geometry.apply(wkt.loads)
    df["geometry"] = df.geometry.apply(lambda x: x.simplify(0.0001, preserve_topology=False))
    df = df[df.geometry.apply(lambda x: len(x.coords)) > 0]
    df["polyline"] = df.geometry.apply(lambda x: polyline.encode(x.coords,5,geojson=True))
    df.drop("geometry", axis=1, inplace=True)
    if request_args and 'columns' in request_args:
        df = df[request_args["columns"].split(",")]
    return json.dumps(df.to_dict(orient="index"), indent=2)


@functions_framework.http
def strava_webhook(request):
    """Responds to Strava Webhook.
    Args:
        request (flask.Request): The request object.
        <https://flask.palletsprojects.com/en/1.1.x/api/#incoming-request-data>
    Returns:
        Authenticates the request and returns the challenge if present.
        For updated activities, updates the activity in the database.
    """

    request_json = request.get_json(silent=True)
    request_args = request.args
    if request_args and 'hub.challenge' in request_args:
        return {"hub.challenge": request_args["hub.challenge"], "rest": str(request_args)}
    if request_json and 'aspect_type' in request_json and request_json["object_type"]=="activity" and request_json["aspect_type"] == "update" or request_json["aspect_type"] == "create":
        print(f"Received {request_json}")
        id = int(request_json["object_id"])
        athlete = int(request_json["owner_id"])
        try:
            default_app = get_app()
        except ValueError:
            default_app = initialize_app()
        ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
        print(f"Updating activity {id}")
        gclient = secretmanager.SecretManagerServiceClient()
        strava_at = gclient.access_secret_version(request={"name": f"projects/stravamap-386413/secrets/strava_access_token_{athlete}/versions/latest"}).payload.data.decode("UTF-8")
        client = Client(access_token=strava_at)
        act = client.protocol.get(f"/activities/{id}",include_all_efforts=True)
        if "athlete" in act:
            act["athlete"]=act["athlete"]["id"]
        if "map" in act:
            try:
                act["geometry"]=LineString(polyline.decode(act["map"]["summary_polyline"],5,geojson=True)).wkt
            except Exception as e:
                print(f"Problem with polyline for {act['id']} due to {e}")
            act.pop("map")
        if "start_latlng" in act:
            act.pop("start_latlng")
        if "end_latlng" in act:
            act.pop("end_latlng")
        id = act.pop("id")
        print(f"{id} updated")
        ref.child(str(id)).update(act)
        return json.dumps(act)
    print(f"Got {request_json} and {request_args} and {request.values} and returned nothing")
    return "Error"

def init_db():
    client = secretmanager.SecretManagerServiceClient()
    strava_at = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_access_token/versions/latest"}).payload.data.decode("UTF-8")
    sclient = Client(access_token=strava_at)
    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    for i in range(150):
        try:
            activities = sclient.protocol.get("/athlete/activities",page=i)
            print(f"Page {i} downloaded")
        except Exception as e:
            print(f"Problem with page {i} due to {e}")
        for act in activities:
            if "athlete" in act:
                act["athlete"]=act["athlete"]["id"]
            if "map" in act:
                try:
                    act["geometry"]=LineString(polyline.decode(act["map"]["summary_polyline"],5,geojson=True)).wkt
                except Exception as e:
                    print(f"Problem with polyline for {act['id']} due to {e}")
                act.pop("map")
            if "start_latlng" in act:
                act.pop("start_latlng")
            if "end_latlng" in act:
                act.pop("end_latlng")
            id = act.pop("id")
            print(f"{id} updated")
            ref.child(str(id)).update(act)