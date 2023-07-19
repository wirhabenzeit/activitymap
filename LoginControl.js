
export class LoginControl {
    
    constructor() {
        this._container;
        this._map;
    }
    
    onAdd = (map) => {
        this._map = map;
        this._container = document.createElement('div');
        this._container.id = 'login-control';
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        const button = document.createElement('button');
        button.style.width = 'auto';
        button.style.height = 'auto';
        button.type = 'button';
        button.id = "login-button";
        const embed = document.createElement('embed');
        embed.src = 'btn_strava_connectwith_light.svg'
        button.appendChild(embed);

        button.onclick = () => {
            const href = window.location.href;
            const dir = href.substring(0, href.lastIndexOf('/'));
            location.href = `https://www.strava.com/oauth/authorize?client_id=106267&response_type=code&redirect_uri=${dir}/login.html&approval_prompt=auto&scope=read,activity:read`;
        };
        
        this._container.appendChild(button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map;
    }
    
}