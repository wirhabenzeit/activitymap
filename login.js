import './style.css';

console.log("Hello from login.js!");

const url = new URL(window.location);
console.log(url.searchParams.get("code"));

if (url.searchParams.has("code")) {
    console.log("Code found!")
    fetch("https://yvkdmnzwrhvjckzyznwu.supabase.co/functions/v1/strava-login?code=" + url.searchParams.get("code"))
    .then(response => {
        console.log(response)
        return response.json();
    })
    .then(data => {
        console.log(data);
        if (data.id) {
            const params = new URLSearchParams(data).toString();
            window.location.href = "/manage.html?" + params;
        }
        else if (data.athlete) {
            document.cookie = `athlete=${data.athlete}; max-age=${24*60*60*30}; path=/;`;
            //window.location.href = "/";
        }
        else {
            document.getElementById("error").innerHTML = JSON.stringify(data);
        }
    });
}