
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
        
        /*button.onclick = () => {
            //document.cookie = `athlete=6824046; max-age=${24*60*60*30}; path=/;`;
            //location.reload();
            return ;
        };*/

        button.onclick = () => {
            location.href = "https://www.strava.com/oauth/authorize?client_id=106267&response_type=code&redirect_uri=http://localhost:5173/login.html&approval_prompt=auto&scope=read,activity:read";
        };
        
        this._container.appendChild(button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map;
    }
    
}