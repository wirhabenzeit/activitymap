import './style.css';

console.log("Hello from login.js!");

const url = new URL(window.location);
console.log(url.searchParams.get("code"));

if (url.searchParams.has("code")) {
    console.log("Code found!")
    const response = await fetch("https://google.com/");
    //const response = await fetch("https://yvkdmnzwrhvjckzyznwu.supabase.co/functions/v1/strava-login?code=" + url.searchParams.get("code"));
    const json = await response.json();
    console.log(json);
}