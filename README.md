# endur
Using Strava data to create personalized reports.

![Pull and clean data](https://github.com/harveybarnhard/endur/workflows/Pull%20and%20clean%20data/badge.svg)
![Last Updated](https://img.shields.io/date/1683803103?color=FC4C02&label=Last%20Updated&logo=strava)

# Replication Steps
Here are the steps I took to get this up-and-running. If other people start using this I'll find a more streamlined
way to replicate this, especially by removing the need for steps 4 and 5.

## Step 1: Prepare Strava
Create an "application" on [Strava](https://www.strava.com/settings/api). Put "local host" (without the quotes)
in the "Authorization Callback Domain" field.

## Step 2: Obtain Authorization
Copy and paste the following link into your browser, replacing `[CLIENT ID HERE]`
with your numeric Client ID found on your Strava [application settings page](https://www.strava.com/settings/api).
```
http://www.strava.com/oauth/authorize?client_id=[CLIENT_ID_HERE]&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=profile:read_all,activity:read_all
```
then click authorize when you visit the above link.

## Step 3: Obtain Access Token
You will then land on a page with a url that looks like
```
http://localhost/exchange_token?state=&code=[A LONG CODE HERE]&scope=read,activity:read_all,profile:read_all
```
where instead of `[A LONG CODE HERE]` there is a long code. Copy and past this code--we'll use it again in the
next step.

## Step 4: Create strava_tokens.json
Run `get_data.py` after modifying the code so that line seven reads:

``` python
copied_code = '[A LONG CODE HERE]'
```
where `[A LONG CODE HERE]` is replaced with the code copied from the url in the prior step.
This will create a file called strava_tokens.json in the data file that contains
access and refresh tokens so that you can pull data using the Strava API.

## Step 5: Encrypt strava_tokens.json
Encrypt strava_tokens.json so that others can't see your tokens. To do this, 
run the script `endur/encrypt_secret.sh`
but replacing `$STRAVA_TOKENS_PHRASE` with a password of your choosing (don't edit this
file, just make a copy. Write this
password down temporarily, but then you won't need it anymore after the next step.
To run the file, open a terminal, go to the filepath of the (copied) `endur/encrypt_secret.sh`
and run

```sh
sh encrypt_secret_copy.sh
```
If the file `data/strava_tokens.json.gpg` is created, then you succeeded in encrypting your file.
Then delete `encrypt_secret_copy.sh` and the un-encrypted `data/strava_tokens.json`. You're now
done with the most laborious steps.

## Step 6: Set GitHub Secrets
Under the settings page for GitHub Actions for this repository, set the following secrets:

* `STRAVA_CLIENT_ID`: The client ID found on your Strava [application settings page](https://www.strava.com/settings/api)
* `STRAVA_CLIENT_SECRET`: The client secret found on your Strava [application settings page](https://www.strava.com/settings/api)
* `STRAVA_TOKENS_PHRASE`: The password you chose in the previous step
