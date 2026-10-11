/** Two reference marks must lie in the same flat plane as the remnant. */
export type ReferencePoint={x:number;y:number};
export function calibratePhotoWidth(a:ReferencePoint,b:ReferencePoint,referenceMm:number,imageWidth:number,imageHeight:number):number{
 if(![a.x,a.y,b.x,b.y,referenceMm,imageWidth,imageHeight].every(Number.isFinite)||[a.x,a.y,b.x,b.y].some(n=>n<0||n>1)||referenceMm<=0||imageWidth<=0||imageHeight<=0)throw new Error('Use two valid ruler marks and a positive measured distance.');
 const normalizedDistance=Math.hypot(b.x-a.x,(b.y-a.y)*imageHeight/imageWidth);
 if(normalizedDistance<.03)throw new Error('Choose reference marks farther apart for a more reliable scale.');
 const width=referenceMm/normalizedDistance;
 if(width<50||width>3000)throw new Error('Calculated full-photo width must be between 50 and 3000 mm. Check the reference distance.');
 return width;
}
