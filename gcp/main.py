from flask import escape
import os
from shapely.geometry import LineString
import functions_framework
from stravalib.client import Client
import json
import pandas as pd
from shapely import wkt
import geopandas as gpd
from firebase_admin import db, initialize_app, get_app
from google.cloud import secretmanager
import polyline

@functions_framework.http
def strava_geojson(request):
    client = secretmanager.SecretManagerServiceClient()
    s_client=Client()
    client_id = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_client_id/versions/latest"}).payload.data.decode("UTF-8")
    client_secret = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_client_secret/versions/latest"}).payload.data.decode("UTF-8")
    old_rt = client.access_secret_version(request={"name": "projects/stravamap-386413/secrets/strava_refresh_token/versions/latest"}).payload.data.decode("UTF-8")

    newcred = s_client.refresh_access_token(client_id=client_id,client_secret=client_secret,refresh_token=old_rt)

    # Add the secret version.
    response = client.add_secret_version(
        request={
            "parent": "projects/stravamap-386413/secrets/strava_access_token",
            "payload": {"data": newcred["access_token"].encode("UTF-8") },
        }
    )
    response2 = client.add_secret_version(
        request={
            "parent": "projects/stravamap-386413/secrets/strava_refresh_token",
            "payload": {"data": newcred["refresh_token"].encode("UTF-8") },
        }
    )
    print(response, response2)
    try:
        default_app = get_app()
    except ValueError:
        default_app = initialize_app()
    ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
    df=pd.DataFrame.from_dict(ref.get(),orient="index")
    df.loc[df.geometry.notnull(),"geometry"] = df[df.geometry.notnull()].geometry.apply(wkt.loads)
    gdf = gpd.GeoDataFrame(df[df.geometry.notnull()], geometry="geometry")
    request_args = request.args
    if request_args and 'type' in request_args:
        gdf = gdf[gdf["type"]==request_args["type"]]
    #else:
    #    gdf = gdf[gdf["type"]=="BackcountrySki"]
    return gdf.to_json()

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
    if request_json and 'aspect_type' in request_json and request_json["aspect_type"] == "update" or request_json["aspect_type"] == "create":
        id = int(request_json["object_id"])
        try:
            default_app = get_app()
        except ValueError:
            default_app = initialize_app()
        ref = db.reference(url="https://stravamap-386413-default-rtdb.europe-west1.firebasedatabase.app")
        print(f"Updating activity {id}")
        
        client=Client(access_token=f"{os.environ['STRAVA_ACCESS_TOKEN']}")
        act = client.protocol.get(f"/activities/{id}",include_all_efforts=True)
        if "athlete" in act:
            act.pop("athlete")
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
        # act = {}
        # act["name"] = act_in["name"]
        # act["distance"] = act_in["distance"]
        # act["total_elevation_gain"] = act_in["total_elevation_gain"]
        # act["elapsed_time"] = act_in["elapsed_time"]
        # act["type"] = act_in["type"]
        # act["sport_type"] = act_in["sport_type"]
        # act["start_date_local"] = act_in["start_date_local"]
        # ls=LineString([[y,x] for x,y in client.get_activity_streams(id, types=["latlng"], resolution='medium')["latlng"].data])
        # ls=ls.simplify(.001,preserve_topology=False)
        # act["geometry"] = ls.wkt
        # ref.child(str(id)).update(act)
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
                act.pop("athlete")
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